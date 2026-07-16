require("./_lib/loadEnv");

module.exports = (req, res) => {
  const keys = Object.keys(process.env).filter((k) => k.includes("CLAUDE"));
  res.status(200).json({
    hasClaudeKey: Boolean(process.env.CLAUDE_API_KEY),
    keyLength: process.env.CLAUDE_API_KEY ? process.env.CLAUDE_API_KEY.length : 0,
    matchingEnvKeys: keys,
    cwd: process.cwd(),
  });
};
