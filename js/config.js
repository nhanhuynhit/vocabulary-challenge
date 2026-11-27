/*
 * Cấu hình kết nối Supabase.
 * Lấy 2 giá trị này trong Supabase: Project Settings → API.
 *  - SUPABASE_URL: "Project URL", dạng https://xxxx.supabase.co
 *  - SUPABASE_ANON_KEY: khóa "anon public"
 * Khóa anon được phép công khai trên web: dữ liệu đã được bảo vệ bằng
 * các quy tắc bảo mật (Row Level Security) trong supabase/schema.sql.
 * KHÔNG bao giờ dán khóa "service_role" vào đây.
 */
window.VC_CONFIG = {
  SUPABASE_URL: "https://nkwpqetdpwenydlrsuso.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd3BxZXRkcHdlbnlkbHJzdXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3MDA1MzAsImV4cCI6MjExMTI3NjUzMH0.JPJgWFp9fJJKyhXH7ieBeri1tdiX5m1xfEuATnLEjg4",
  // Bật nút "Tiếp tục với Google" sau khi đã cấu hình Google trong Supabase.
  GOOGLE_LOGIN: false
};
