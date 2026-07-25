// config.js
const CONFIG = {
    // Supabase 프로젝트 URL (예: https://abcdefghijklmno.supabase.co)
    SUPABASE_URL: 'https://lbefvvdbmscygholebzp.supabase.co',

    // Supabase Anon Key (public)
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiZWZ2dmRibXNjeWdob2xlYnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2ODg5MDIsImV4cCI6MjA5OTI2NDkwMn0.5SX5EfVjS9ej1FaQHxe26h3dTzEfz5qeKkp2qq6U8nI',

    // true로 설정하면 Supabase 없이 LocalStorage와 BroadcastChannel을 통해 
    // 동일 브라우저 내에서만 통신하는 목업(Mock) 모드로 동작합니다.
    LOCAL_MODE_ONLY: false
};
