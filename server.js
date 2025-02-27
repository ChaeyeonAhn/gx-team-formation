const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const WebSocket = require("ws");
const config = require("./config");
const { v4: uuidv4 } = require("uuid");
const { MongoClient, GridFSBucket } = require("mongodb");
const Grid = require("gridfs-stream");
const multer = require("multer");

const clients = new Map();

const app = express();
const port = config.port;

const userList = new Set();
const userStatus = new Map();
userStatus.set("mongodb", { status: "1" });
// map.set("user1", { online: true });

let id = "";

app.use(express.json({ limit: "50mb" })); // 크기 제한 설정
app.use(
  cors({
    origin: config.origin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// MongoDB Client for GridFS
const client = new MongoClient(config.mongoURL);
let bucket;
const MAX_SIZE_FOR_NORMAL_UPLOAD = 16 * 1024 * 1024; // 16 MB

client
  .connect()
  .then(() => {
    // Multer setup for file uploads
    const upload = multer({
      limits: { fieldSize: MAX_SIZE_FOR_NORMAL_UPLOAD },
    });
  })
  .catch((err) => console.error(err));

// WebSocket setup
const wss = new WebSocket.Server({ port: config.wsPort });
wss.on("connection", (ws) => {
  id = uuidv4();
  clients.set(id, ws);
  ws.id = id;
  console.log("A client has connected with id:", id);
  const jsonMessage = JSON.stringify({
    clientId: id,
    type: "REGISTER-USER",
    data: [],
  });
  console.log("message is" + jsonMessage);
  ws.send(jsonMessage);

  ws.on("message", (message) => {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on("close", () => {
    clients.delete(id);
    userList.delete(id);
    userStatus.delete(id); // delete user

    console.log("Client disconnected:", id);
  });

  ws.send(JSON.stringify({ message: id }));
});

// Mongoose Data Schema and REST API
const dataSchema = new mongoose.Schema({
  data: [
    {
      noteId: String,
      noteText: String,
      notePos: {
        x: Number,
        y: Number,
        z: Number,
      },
    },
  ],
});

async function connectToDatabase() {
  try {
    // Check if the mongoose connection is active (connected or connecting)
    if (mongoose.connection.readyState !== 0) {
      if (mongoose.connection.db.databaseName !== "db") {
        console.log("Closing existing MongoDB connection...");
        await mongoose.connection.close();
        console.log("Existing connection closed.");
      } else {
        console.log("Existing connection is same as new database.");
      }
    }
  } catch (error) {
    console.error(
      "Error while closing the existing MongoDB connection:",
      error
    );
    throw error; // Optionally rethrow the error if it should be handled by the caller
  }
  try {
    await mongoose.connect(config.mongoURL + "/db");

    console.log(`Connected to database`);
    console.log(mongoose.connection.name);
    console.log(mongoose.connection.databaseName);
  } catch (err) {
    console.error("MongoDB connection error:", err);
    throw err; // Optionally rethrow the error if it should be handled by the caller
  }
}

// chacha
app.post("/register-user", async (req, res) => {
  const { username } = req.body;

  if (userList.has(username)) {
    return res
      .status(409)
      .json({ error: "Already registered. Log out again." });
  }

  console.log(username);

  userList.add(username);
  console.log(userList);

  try {
    const SNData =
      mongoose.models.StickyNotes ||
      mongoose.model("StickyNotes", dataSchema, "stickyNotes");
    const data = await SNData.find({});
    console.log("data" + data.length);
    // data.forEach(({ _id, data }) => {
    //   console.log(`문서 ID: ${_id}`);
    //   console.log(data[0]);

    //   data.forEach(({ noteId, noteText, notePos }) => {
    //     console.log(`  noteId: ${noteId}`);
    //     console.log(`  noteText: ${noteText}`);
    //     console.log(
    //       `  notePos: x=${notePos.x}, y=${notePos.y}, z=${notePos.z}`
    //     );
    //   });
    // });

    console.log(data[0].data);

    // send server status to client
    const wsClient = clients.get(username);
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(
        JSON.stringify({ clientId: id, type: "REFRESHED", data: data[0].data })
      );
    } else {
      console.log("ws client not found for username");
    }

    userStatus.set(username, userStatus.get("mongodb"));
  } catch (error) {
    console.error("Error fetching initial data:", error);
  }

  res.status(200).json({ success: "Register success!" });
});

// chacha
// app.post("/load-data", async (req, res) => {
//   try {
//     // await connectToDatabase();
//     const SNData = mongoose.model("StickyNotes", dataSchema, "stickyNotes");

//     const data = await SNData.find();
//     res.status(200).json(data);
//   } catch (error) {
//     console.error("Failed to load data:", error);
//     res
//       .status(500)
//       .json({ status: "error", message: "Failed to load data", data: error });
//   }
// });

// chacha
app.post("/update-data", async (req, res) => {
  console.log("update data!");
  const { clientId, noteId, noteText, notePos } = req.body;

  if (!userList.has(clientId)) {
    return res.status(409).json({ error: "Unknown client." });
  }
  console.log("Who is making change: " + clientId);

  try {
    const SNData =
      mongoose.models.StickyNotes ||
      mongoose.model("StickyNotes", dataSchema, "stickyNotes");
    const foundData = await SNData.find({});
    const firstData = foundData[0].data;
    console.log(firstData);

    let noteExists = firstData.some((element) => element.noteId === noteId);

    if (!noteExists) {
      // new note!
      firstData.push({ noteId, noteText, notePos });

      await SNData.deleteMany();
      const newDoc = new SNData({ data: firstData });
      await newDoc.save();

      const newStatus = uuidv4();
      userStatus.set("mongodb", { status: newStatus });
      userStatus.set(clientId, { status: newStatus });

      userStatus.forEach((value, key) => {
        console.log(`${key}: ${JSON.stringify(value)}`); // value를 JSON 문자열로 변환하여 출력
      });

      let keysWithDifferentValue = []; // who has different status? (not refreshed yet)

      // userStatus, find someone that doesn't have new Status.
      userStatus.forEach((value, key) => {
        if (value.status !== newStatus) {
          keysWithDifferentValue.push(key); // add them to the list.
        }
      });

      console.log(keysWithDifferentValue);
      console.log(clients);

      for (key in keysWithDifferentValue) {
        const wsClient = clients.get(key);
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(
            JSON.stringify({
              clientId: key,
              type: "REFRESHED",
              data: data[0].data,
            })
          ); // send refreshed message to the clients
          userStatus.set(key, { status: newStatus });
          console.log(userStatus);
        } else {
          console.log("ws client not found for username");
        }
      }

      return res.status(200).json({
        message: "New note added successfully, and all has been updated",
        data: newDoc,
      });
    } else {
      const remainingData = firstData.filter((e) => e.noteId !== noteId);
      remainingData.push({ noteId, noteText, notePos });

      await SNData.deleteMany();
      const newDoc = new SNData({ data: firstData });
      await newDoc.save();

      const newStatus = uuidv4();
      userStatus.set("mongodb", { status: newStatus });
      userStatus.set(clientId, { status: newStatus });

      userStatus.forEach((value, key) => {
        console.log(`${key}: ${JSON.stringify(value)}`); // value를 JSON 문자열로 변환하여 출력
      });

      let keysWithDifferentValue = []; // who has different status? (not refreshed yet)

      // userStatus, find someone that doesn't have new Status.
      userStatus.forEach((value, key) => {
        if (value.status !== newStatus) {
          keysWithDifferentValue.push(key); // add them to the list.
        }
      });

      for (key in keysWithDifferentValue) {
        const wsClient = clients.get(key);
        console.log(key);
        console.log(wsClient);
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(
            JSON.stringify({
              clientId: key,
              type: "REFRESHED",
              data: data[0].data,
            })
          ); // send refreshed message to the clients
          userStatus.set(key, { status: newStatus });
          console.log(userStatus);
        } else {
          console.log("ws client not found for username");
        }
      }

      return res
        .status(200)
        .json({ message: "New note modified successfully", data: newDoc });
    }
  } catch (error) {
    console.error("Failed to update data:", error);
    res
      .status(500)
      .json({ status: "error", message: "Failed to update data", data: error });
  }
});

connectToDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server is running on port: ${port}`);
    });
  })
  .catch((err) => {
    console.error(
      "Failed to start server due to MongoDB connection error:",
      err
    );
  });
