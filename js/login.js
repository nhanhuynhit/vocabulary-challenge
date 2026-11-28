/* Login page: sign in, sign up, Google, forgot password and set a new password. */
(function () {
  const sb = window.VC_SUPABASE;
  const $ = (s) => document.querySelector(s);
  const appUrl = new URL("index.html", location.href).href;
  const loginUrl = new URL("login.html", location.href).href;
  let mode = "login";          // login | signup | forgot | reset
  let busy = false;
  let pwShown = false;         // đang hiện mật khẩu thì không cần ô nhập lại

  if (!sb) { $("#setup").hidden = false; $("#auth").hidden = true; return; }
  if ((window.VC_CONFIG || {}).GOOGLE_LOGIN) { $("#or").hidden = false; $("#google").hidden = false; }

  const TEXT = {
    login:  { title: "Chào mừng trở lại!", sub: "Đăng nhập để học tiếp và giữ chuỗi ngày học của bạn.", btn: "Đăng nhập" },
    signup: { title: "Tạo tài khoản miễn phí", sub: "Chỉ mất 30 giây. Tiến độ của bạn được lưu trên mọi thiết bị.", btn: "Tạo tài khoản" },
    forgot: { title: "Quên mật khẩu", sub: "Nhập email của bạn, chúng tôi sẽ gửi đường link để đặt lại mật khẩu.", btn: "Gửi link đặt lại" },
    reset:  { title: "Đặt mật khẩu mới", sub: "Nhập mật khẩu mới cho tài khoản của bạn.", btn: "Lưu mật khẩu mới" }
  };

  function setMode(m) {
    mode = m;
    const t = TEXT[m];
    $("#form-title").textContent = t.title;
    $("#form-sub").textContent = t.sub;
    $("#submit").textContent = t.btn;
    $("#f-name").hidden = m !== "signup";
    $("#f-email").hidden = m === "reset";
    $("#f-password").hidden = m === "forgot";
    $("#f-password2").hidden = !(m === "signup" || m === "reset") || pwShown;
    $("#f-ref").hidden = m !== "signup";
    $("#forgot-row").hidden = m !== "login";
    $(".tabs").hidden = m === "forgot" || m === "reset";
    const google = !!(window.VC_CONFIG || {}).GOOGLE_LOGIN && (m === "login" || m === "signup");
    $("#or").hidden = !google; $("#google").hidden = !google;
    $("#password").autocomplete = m === "login" ? "current-password" : "new-password";
    $("#tab-login").setAttribute("aria-selected", String(m === "login"));
    $("#tab-signup").setAttribute("aria-selected", String(m === "signup"));
    if (m === "forgot") {
      const back = document.createElement("button");
      back.type = "button"; back.className = "link"; back.id = "back"; back.textContent = "← Quay lại đăng nhập";
      if (!$("#back")) $("#form").appendChild(back);
    } else if ($("#back")) $("#back").remove();
    showMsg("");
  }

  function showMsg(text, ok) {
    const m = $("#msg");
    m.hidden = !text; m.textContent = text || ""; m.className = "msg" + (ok ? " ok" : "");
  }

  function friendly(err) {
    const s = String((err && err.message) || err || "");
    if (s === "REF_NOT_FOUND") return "Không tìm thấy mã giới thiệu này. Hãy kiểm tra lại, hoặc để trống ô này.";
    if (/invalid login credentials/i.test(s)) return "Email hoặc mật khẩu không đúng.";
    if (/email not confirmed/i.test(s)) return "Bạn chưa xác nhận email. Hãy mở hộp thư và bấm vào link xác nhận.";
    if (/already registered|already been registered|user already exists/i.test(s)) return "Email này đã có tài khoản. Hãy chuyển sang Đăng nhập.";
    if (/password should be at least|password.*6/i.test(s)) return "Mật khẩu cần ít nhất 6 ký tự.";
    if (/rate limit|too many/i.test(s)) return "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.";
    if (/invalid.*email|email.*invalid/i.test(s)) return "Địa chỉ email không hợp lệ.";
    if (/session missing|expired|invalid.*token|otp/i.test(s)) return "Link đặt lại mật khẩu đã hết hạn. Hãy bấm Quên mật khẩu để nhận link mới.";
    if (/network|fetch/i.test(s)) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
    return "Có lỗi xảy ra: " + s;
  }

  // "nhân-ab12 cd34", "NHANAB12CD34" → "NHAN-AB12CD34"; "" khi bỏ trống; null khi sai dạng
  function normRef(v) {
    let c = String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "D")
      .toUpperCase().replace(/[\s_]/g, "");
    if (!c) return "";
    if (/^[A-Z]{1,10}[A-Z0-9]{8}$/.test(c) && !c.includes("-")) c = c.slice(0, -8) + "-" + c.slice(-8);
    return /^[A-Z]{1,10}-[A-Z0-9]{8}$/.test(c) ? c : null;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const email = $("#email").value.trim(), pw = $("#password").value, pw2 = $("#password2").value, name = $("#name").value.trim();
    if (mode !== "reset" && !/^\S+@\S+\.\S+$/.test(email)) return showMsg("Vui lòng nhập email hợp lệ.");
    if ((mode === "login" || mode === "signup" || mode === "reset") && pw.length < 6) return showMsg("Mật khẩu cần ít nhất 6 ký tự.");
    if ((mode === "signup" || mode === "reset") && !pwShown && pw !== pw2) return showMsg("Hai mật khẩu chưa khớp nhau.");
    if (mode === "signup" && !name) return showMsg("Vui lòng nhập tên hiển thị.");
    const ref = mode === "signup" ? normRef($("#ref").value) : "";
    if (ref === null) return showMsg("Mã giới thiệu có dạng TÊN-8 ký tự, ví dụ NHAN-AB12CD34. Bạn có thể để trống ô này.");

    busy = true; $("#submit").disabled = true; showMsg("");
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        location.replace(appUrl);
      } else if (mode === "signup") {
        if (ref) {
          const { data: found, error: refErr } = await sb.rpc("ref_code_exists", { code: ref });
          // Nếu máy chủ chưa có hàm kiểm tra (chưa chạy schema mới) thì bỏ qua bước kiểm tra
          if (!refErr && found === false) throw new Error("REF_NOT_FOUND");
          $("#ref").value = ref;
        }
        const meta = { full_name: name.slice(0, 40) };
        if (ref) meta.ref_code = ref;
        const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: meta, emailRedirectTo: appUrl } });
        if (error) throw error;
        if (data.session) location.replace(appUrl);
        else showMsg("Đã tạo tài khoản! Hãy mở email " + email + " và bấm vào link xác nhận, rồi quay lại đăng nhập.", true);
      } else if (mode === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: loginUrl + "?reset=1" });
        if (error) throw error;
        showMsg("Nếu email này đã có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu trong vài phút.", true);
      } else if (mode === "reset") {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw error;
        showMsg("Đã đổi mật khẩu. Đang chuyển vào ứng dụng…", true);
        setTimeout(() => location.replace(appUrl), 900);
      }
    } catch (err) { showMsg(friendly(err)); }
    finally { busy = false; $("#submit").disabled = false; }
  }

  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-mode]"); if (tab) { setMode(tab.dataset.mode); return; }
    if (e.target.closest("#forgot")) { setMode("forgot"); return; }
    if (e.target.closest("#back")) { setMode("login"); return; }
    if (e.target.closest("#eye")) {
      const p = $("#password"), show = p.type === "password";
      p.type = show ? "text" : "password"; pwShown = show;
      $("#f-password2").hidden = !(mode === "signup" || mode === "reset") || show; $("#eye").textContent = show ? "Ẩn" : "Hiện";
      $("#eye").setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
      return;
    }
    if (e.target.closest("#google")) {
      sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: appUrl } })
        .then(({ error }) => { if (error) showMsg(friendly(error)); });
    }
  });
  $("#form").addEventListener("submit", submit);

  // A password-reset link lands here with a recovery session.
  sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") setMode("reset"); });
  const recovering = /type=recovery/.test(location.hash) || /reset=1|type=recovery/.test(location.search);
  if (recovering) setMode("reset");
  else {
    // Link mời: login.html?ref=NHAN-XXXXXXXX mở sẵn form đăng ký và điền mã
    const invite = normRef(new URLSearchParams(location.search).get("ref"));
    setMode(invite || /signup/.test(location.hash) ? "signup" : "login");
    if (invite) $("#ref").value = invite;
    sb.auth.getSession().then(({ data }) => { if (data.session) location.replace(appUrl); });
  }
})();
