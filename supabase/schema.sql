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

-- Tự tạo hồ sơ khi có người đăng ký (lấy tên từ form đăng ký hoặc từ Google)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
                  nullif(new.raw_user_meta_data->>'name', ''),
                  split_part(new.email, '@', 1)), 40),
    new.raw_user_meta_data->>'avatar_url'
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
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.progress to authenticated;
grant select, insert, update on public.board    to authenticated;
