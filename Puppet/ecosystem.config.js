module.exports = {
  apps: [{
    name: "chart5k-puppet",
    script: "./index-ngrok.js", // Replace with your actual main entry script if different
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000, // Wait 3 seconds before trying to restart
    env: {
      PORT: 36007
    }
  }]
};
