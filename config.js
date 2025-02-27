const config = {
  origin: "http://34.135.9.196:3000", // client가 현재 서버 돌아가고 있는 desktop의 IP:3000에 연결할 때 씀.
  port: 5002, // Express 서버 포트
  wsPort: 751, // WebSocket 서버 포트
  mongoURL:
    "mongodb://sketchlab:MOvalpop0bCCSkx8@cluster0-shard-00-00.uw7re.mongodb.net:27017,cluster0-shard-00-01.uw7re.mongodb.net:27017,cluster0-shard-00-02.uw7re.mongodb.net:27017/?replicaSet=atlas-kf81lo-shard-0&ssl=true&authSource=admin&retryWrites=true&w=majority&appName=Cluster0",
  // database connected!
};

module.exports = config;
