require("./_lib/loadEnv");

module.exports = (req, res) => {
  res.status(200).json({
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
    supabaseUrlPreview: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.slice(0, 20) : null,
  });
};
