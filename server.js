const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const WebSocket = require('ws');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

const clients = new Map();

const app = express();
const port = config.port;

app.use(express.json({ limit: '50mb' })); // 크기 제한 설정
app.use(cors({
  origin: config.origin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

mongoose.connect(config.mongoURL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB database connection established successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

const connection = mongoose.connection;
connection.once('open', () => {
  console.log('MongoDB database connection established successfully');
});

const wss = new WebSocket.Server({ port: config.wsPort });
wss.on('connection', ws => {
    const id = uuidv4();
    clients.set(id, ws);
    ws.id = id;
    console.log('A client has connected with id:', id);
    // console.log('A client has connected.');

    ws.on('message', message => {
        // console.log('Received message:', message);
        // console.log('Received message');

        const jsonMessage = JSON.stringify({ message });

        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(jsonMessage);
            }
        });
    });

    ws.on('close', () => {
      clients.delete(id);
      console.log('Client disconnected:', id);
    });

    ws.send(JSON.stringify({ message: id }));
});

const dataSchema = new mongoose.Schema({
  type: String,
  pos: {
    x: Number,
    y: Number,
    z: Number
  },
  textValue: String,
  paperIndex: Number,
  color: {
    r: Number,
    g: Number,
    b: Number,
    a: Number
  },
  noteType: String,
  startPaperId: String,
  endPaperId: String
}, { versionKey: false });

const Data = mongoose.model('Data', dataSchema, 'test');

app.get("/load-data", async (req, res) => {
  try {
      const data = await Data.find();
      res.status(200).json(data);
  } catch (error) {
      console.error('Failed to load data:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load data', data: error });
  }
});

app.post("/upload-data", async (req, res) => {
  const data = req.body;
  if (data._id === null || data._id === "") {
      delete data._id;
  }
  try {
      const newData = await Data.create(data);
      res.status(201).json(newData);
      console.log('Data uploaded successfully.');
  } catch (error) {
      console.error('Failed to upload data:', error);
      res.status(500).json({ status: 'error', message: 'Failed to upload data', data: error });
  }
});

app.post("/update-data", async (req, res) => {
  const { _id, type, pos, textValue, paperIndex, color, noteType, startPaperId, endPaperId } = req.body;
  try {
      console.log(req.body);
      const update = {};
      if (type !== "") update.type = type;
      if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) update.pos = pos;
      update.textValue = textValue;
      if (paperIndex !== 0) update.paperIndex = paperIndex;
      if (color.r !== 0 || color.g !== 0 || color.b !== 0 || color.a !== 0) update.color = color;
      if (noteType !== "") update.noteType = noteType;
      if (startPaperId !== "") update.startPaperId = startPaperId;
      if (endPaperId !== "") update.endPaperId = endPaperId;

      console.log(update);

      const updatedData = await Data.findOneAndUpdate({ _id: _id }, { $set: update }, { new: true });

      if (!updatedData) {
        return res.status(404).json({ status: 'error', message: 'Data not found' });
      }

      res.status(200).json({ status: 'ok', message: 'Data updated successfully' });
  } catch (error) {
      console.error('Failed to update data:', error);
      res.status(500).json({ status: 'error', message: 'Failed to update data', data: error });
  }
});

app.post("/delete-data", async (req, res) => {
  const { _id } = req.body;

  try {
      // _id가 유효한 ObjectId인지 확인
      if (!mongoose.Types.ObjectId.isValid(_id)) {
          return res.status(400).json({ status: 'error', message: 'Invalid ID format' });
      }

      // _id로 데이터를 찾아 삭제
      const deletedData = await Data.findByIdAndDelete(_id);

      if (!deletedData) {
          return res.status(404).json({ status: 'error', message: 'Data not found' });
      }

      res.status(200).json({ status: 'ok', message: 'Data deleted successfully' });
  } catch (error) {
      console.error('Failed to delete data:', error);
      res.status(500).json({ status: 'error', message: 'Failed to delete data', data: error });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});