module.exports = {
  apps: [
    {
      name: "cf-reconciler",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/cli.ts run --config config.yml",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
