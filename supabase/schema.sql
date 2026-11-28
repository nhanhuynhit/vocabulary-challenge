-- Vocabulary Challenge: cơ sở dữ liệu trên Supabase
-- Cách dùng: Supabase → SQL Editor → New query → dán toàn bộ file này → Run.
-- Chạy lại nhiều lần vẫn an toàn.

-- 1) Hồ sơ người học: tên hiển thị và ảnh đại diện (ai đăng nhập cũng xem được, chỉ chủ sửa được)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_url   text,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles: signed-in users can read" on public.profiles;
create policy "profiles: signed-in users can read" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles: owner can insert" on public.profiles;
create policy "profiles: owner can insert" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles: owner can update" on public.profiles;
create policy "profiles: owner can update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Mã giới thiệu: TÊN-XXXXXXXX. TÊN là tên gọi (chữ cuối của tên hiển thị) viết hoa không dấu,
-- ví dụ "Chí Nhân" → NHAN-AB12CD34. 8 ký tự sau ngẫu nhiên, không dùng 0 O 1 I L cho dễ đọc.
-- Mã giữ nguyên khi người dùng đổi tên, để link mời đã gửi vẫn dùng được.
alter table public.profiles add column if not exists ref_code text;
alter table public.profiles add column if not exists referred_by uuid references auth.users(id) on delete set null;
create unique index if not exists profiles_ref_code_key on public.profiles (ref_code);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

-- "Chí Nhân" → "NHAN"; tên không có chữ cái nào → "USER"
create or replace function public.ref_prefix(name text)
returns text language plpgsql immutable set search_path = public as $$
declare
  s text;
  parts text[];
begin
  s := normalize(coalesce(name, ''), NFD);                 -- tách dấu khỏi chữ: "â" → "a" + dấu
  s := regexp_replace(s, '[\u0300-\u036f]', '', 'g');      -- bỏ các dấu
  s := upper(translate(s, 'Đđ', 'Dd'));                     -- "đ" không tách dấu được nên đổi riêng
  s := trim(regexp_replace(s, '[^A-Z]+', ' ', 'g'));        -- chỉ giữ chữ cái A-Z
  if s = '' then return 'USER'; end if;
  parts := string_to_array(s, ' ');
  return left(parts[array_length(parts, 1)], 10);           -- chữ cuối = tên gọi, tối đa 10 ký tự
end;
$$;

drop function if exists public.gen_ref_code();
create or replace function public.gen_ref_code(name text)
returns text language plpgsql volatile set search_path = public as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := public.ref_prefix(name) || '-';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where ref_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.profiles_set_ref_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.ref_code is null then new.ref_code := public.gen_ref_code(new.display_name); end if;
  return new;
end;
$$;

drop trigger if exists profiles_ref_code on public.profiles;
create trigger profiles_ref_code
  before insert on public.profiles
  for each row execute function public.profiles_set_ref_code();

-- Cấp mã cho tài khoản chưa có mã, và đổi các mã kiểu cũ TEN-XXXXXXXX sang mã theo tên
update public.profiles set ref_code = public.gen_ref_code(display_name)
 where ref_code is null
    or (ref_code like 'TEN-%' and public.ref_prefix(display_name) <> 'TEN');

-- Trang đăng ký dùng hàm này để kiểm tra mã người giới thiệu có tồn tại không
create or replace function public.ref_code_exists(code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where ref_code = upper(trim(code)));
$$;
revoke all on function public.ref_code_exists(text) from public;
grant execute on function public.ref_code_exists(text) to anon, authenticated;

-- Tự tạo hồ sơ khi có người đăng ký (lấy tên từ form đăng ký hoặc từ Google, và ghi nhận người giới thiệu nếu có)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  referrer uuid;
begin
  select id into referrer from public.profiles
   where ref_code = upper(trim(coalesce(new.raw_user_meta_data->>'ref_code', '')))
   limit 1;
  insert into public.profiles (id, display_name, avatar_url, referred_by)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
                  nullif(new.raw_user_meta_data->>'name', ''),
                  split_part(new.email, '@', 1)), 40),
    new.raw_user_meta_data->>'avatar_url',
    referrer
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Tiến độ học: riêng tư, chỉ chủ tài khoản đọc và ghi
create table if not exists public.progress (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;

drop policy if exists "progress: owner can read" on public.progress;
create policy "progress: owner can read" on public.progress
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "progress: owner can insert" on public.progress;
create policy "progress: owner can insert" on public.progress
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "progress: owner can update" on public.progress;
create policy "progress: owner can update" on public.progress
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Bảng xếp hạng: chỉ các con số tổng; ai đăng nhập cũng xem được, mỗi người chỉ ghi dòng của mình
create table if not exists public.board (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  learned     integer not null default 0 check (learned between 0 and 10000),
  strong      integer not null default 0 check (strong between 0 and 10000),
  lessons     integer not null default 0 check (lessons between 0 and 1000),
  streak_n    integer not null default 0 check (streak_n between 0 and 10000),
  streak_last integer not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.board enable row level security;

drop policy if exists "board: signed-in users can read" on public.board;
create policy "board: signed-in users can read" on public.board
  for select to authenticated using (true);

drop policy if exists "board: owner can insert" on public.board;
create policy "board: owner can insert" on public.board
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "board: owner can update" on public.board;
create policy "board: owner can update" on public.board
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists board_learned_idx on public.board (learned desc);

-- Cập nhật bảng xếp hạng theo thời gian thực
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board') then
    alter publication supabase_realtime add table public.board;
  end if;
end $$;

-- 4) Cấp quyền truy cập bảng cho người dùng đã đăng nhập.
--    Một số dự án Supabase mới không tự cấp quyền này, khiến việc ghi bị từ chối (lỗi 42501).
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
-- Người dùng chỉ được sửa tên và ảnh; mã giới thiệu và người giới thiệu do máy chủ quản lý.
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name, avatar_url) on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select, insert, update on public.progress to authenticated;
grant select, insert, update on public.board    to authenticated;
