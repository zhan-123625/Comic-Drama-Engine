const path = require("path");

module.exports = {
  apps: [
    {
      name: "comic-drama-engine",
      script: "server/index.ts",
      cwd: __dirname,
      interpreter: "node",
      interpreter_args: "--import tsx",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(__dirname, "logs/pm2-error.log"),
      out_file: path.join(__dirname, "logs/pm2-out.log"),
      merge_logs: true,
    },
  ],
};
