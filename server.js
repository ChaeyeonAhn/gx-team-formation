const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const WebSocket = require('ws');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, GridFSBucket } = require('mongodb');
const Grid = require('gridfs-stream');
const multer = require('multer');

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

// MongoDB Client for GridFS
const client = new MongoClient(config.mongoURL);
let bucket;
const MAX_SIZE_FOR_NORMAL_UPLOAD = 16 * 1024 * 1024; // 16 MB

client.connect().then(() => {
  // Multer setup for file uploads
  const upload = multer({
    limits: { fieldSize: MAX_SIZE_FOR_NORMAL_UPLOAD }
  });

  // MongoDB에 PDF 업로드
  app.post('/upload_pdf/:projectName', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file part' });
    }

    const { fileId } = req.body;
    const pdfData = req.file.buffer;
    const { projectName } = req.params;

    try {
      
      const db = client.db(projectName);
      bucket = new GridFSBucket(db);
      console.log(projectName);
      
      if (pdfData.length > MAX_SIZE_FOR_NORMAL_UPLOAD) {
        // Use GridFS
        const uploadStream = bucket.openUploadStream(fileId, {
          metadata: { fileid: fileId }
        });
        uploadStream.end(pdfData);
        uploadStream.on('finish', () => {
          res.json({ message: 'PDF uploaded successfully' });
        });
        uploadStream.on('error', (err) => {
          console.error('GridFS upload error:', err);
          res.status(500).json({ error: 'Failed to upload PDF to GridFS' });
        });
      } else {
        // Normal MongoDB storage
        const pdfCollection = db.collection('PDF');
        const pdfDocument = {
          fileid: fileId,
          data: pdfData,
        };
        await pdfCollection.insertOne(pdfDocument);
        res.json({ message: 'PDF uploaded successfully' });
      }
    } catch (error) {
      console.error('Error during upload:', error);
      res.status(500).json({ error: 'An error occurred during the upload process' });
    }
  });

  // MongoDB로부터 PDF ID 리스트 받아옴
  app.get('/list_pdfs/:projectName', async (req, res) => {
    const { projectName } = req.params;

    const db = client.db(projectName);
    bucket = new GridFSBucket(db);

    const pdfCollection = db.collection('PDF');
    const pdfDocuments = await pdfCollection.find({}).toArray();

    const fileidList = pdfDocuments.map(doc => doc.fileid);

    const gridfsFiles = await bucket.find({}).toArray();
    const gridfsFileidList = gridfsFiles
      .filter(file => file.metadata && file.metadata.fileid)
      .map(file => file.metadata.fileid);

    const allFileids = [...fileidList, ...gridfsFileidList];
    res.json({ fileids: allFileids });
  });

  // MongoDB에서 각 fileid에 해당하는 PDF 다운로드
  app.get('/download_pdf/:projectName/:fileid', async (req, res) => {
    const { projectName, fileid } = req.params;

    try {
      const db = client.db(projectName);
      bucket = new GridFSBucket(db);
      
      // Check in normal MongoDB storage
      const pdfCollection = db.collection('PDF');
      const pdfDocument = await pdfCollection.findOne({ fileid });

      if (pdfDocument) {
        const pdfData = Buffer.isBuffer(pdfDocument.data) ? pdfDocument.data : pdfDocument.data.buffer; // Convert to Buffer if necessary
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${fileid}.pdf`);
        res.send(pdfData);
      } else {
        // Check in GridFS
        const gridFile = await bucket.find({ filename: fileid }).toArray();

        if (gridFile.length > 0) {
          const downloadStream = bucket.openDownloadStreamByName(fileid);
          downloadStream.pipe(res);

          downloadStream.on('error', () => {
            res.status(404).json({ error: 'File not found' });
          });
        } else {
          res.status(404).json({ error: 'File not found in GridFS' });
        }
      }
    } catch (error) {
      console.error('Error during download:', error);
      res.status(500).json({ error: 'An error occurred during the download process' });
    }
  });

}).catch(err => console.error(err));

// WebSocket setup
const wss = new WebSocket.Server({ port: config.wsPort });
wss.on('connection', ws => {
  const id = uuidv4();
  clients.set(id, ws);
  ws.id = id;
  console.log('A client has connected with id:', id);

  ws.on('message', message => {
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

// Mongoose Data Schema and REST API
const dataSchema = new mongoose.Schema({
  type: String,
  pos: {
    x: Number,
    y: Number,
    z: Number
  },
  textValue: String,
  paperName: String,
  year: String,
  resourceLink: String,
  publicationVenue: String,
  resultId: String,
  citesId: String,
  citationCount: String,
  referenceTitleList: {
    key: [String],
    value: [{
      array: [String]
    }]
  },
  citationTitleList: {
    key: [String],
    value: [{
      array: [String]
    }]
  },
  abovePageIndex: Number,
  referenceTextArray: [String],
  highlightTexts: [{
    item1: [Number],
    item2: [Number],
    item3: [{
      r: Number,
      g: Number,
      b: Number,
      a: Number
    }],
  }],
  paperIndex: Number,
  color: {
    r: Number,
    g: Number,
    b: Number,
    a: Number
  },
  noteType: String,
  startPaperId: String,
  endPaperId: String,
  labelPosIndex: {
    item1: Number,
    item2: Number
  },
  scaleFactor: Number,
}, { versionKey: false });

async function connectToDatabase(dbName) {
  const uri = `${config.mongoURL}/${dbName}`; // MongoDB URI (자신의 설정에 맞게 수정)

  try {
    // Check if the mongoose connection is active (connected or connecting)
    if (mongoose.connection.readyState !== 0) {
      if (mongoose.connection.db.databaseName !== dbName) {
        console.log('Closing existing MongoDB connection...');
        await mongoose.connection.close();
        console.log('Existing connection closed.');
      } else {
        console.log('Existing connection is same as new database.');
      }
    }
  } catch (error) {
    console.error('Error while closing the existing MongoDB connection:', error);
    throw error;  // Optionally rethrow the error if it should be handled by the caller
  }
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log(`Connected to database: ${dbName}`);
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err;  // Optionally rethrow the error if it should be handled by the caller
  }
};


app.post("/load-data", async (req, res) => {
  try {
    await connectToDatabase(req.body._projectName);
    const Data = mongoose.model('Data', dataSchema, 'SaveFile');

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
    await connectToDatabase(data._projectName);
    const Data = mongoose.model('Data', dataSchema, 'SaveFile');

    const newData = await Data.create(data);
    res.status(201).json(newData);
    console.log('Data uploaded successfully.');
  } catch (error) {
    console.error('Failed to upload data:', error);
    res.status(500).json({ status: 'error', message: 'Failed to upload data', data: error });
  }
});

app.post("/update-data", async (req, res) => {
  const { _projectName, _id, type, pos, textValue, paperName, year, resourceLink, publicationVenue, resultId, citesId, citationCount, referenceTitleList, citationTitleList, abovePageIndex, referenceTextArray, highlightTexts, copiedOrigianlPaperId, paperIndex, color, noteType, startPaperId, endPaperId, labelPosIndex, scaleFactor } = req.body;
  try {
    await connectToDatabase(_projectName);
    const Data = mongoose.model('Data', dataSchema, 'SaveFile');

    const update = {};
    if (type !== "") update.type = type;
    if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) update.pos = pos;
    update.textValue = textValue;
    if (paperName !== "") update.paperName = paperName;
    if (year !== "") update.year = year;
    if (resourceLink !== "") update.resourceLink = resourceLink;
    if (publicationVenue !== "") update.publicationVenue = publicationVenue;
    if (resultId !== "") update.resultId = resultId;
    if (citesId !== "") update.citesId = citesId;
    if (citationCount !== "") update.citationCount = citationCount;
    if (referenceTitleList !== null && referenceTitleList.key.length !== 0) update.referenceTitleList = referenceTitleList;
    if (citationTitleList !== null && citationTitleList.key.length !== 0) update.citationTitleList = citationTitleList;
    update.abovePageIndex = abovePageIndex;
    if (referenceTextArray !== null && referenceTextArray.length !== 0) update.referenceTextArray = referenceTextArray;
    if (highlightTexts !== null && highlightTexts.length !== 0) update.highlightTexts = highlightTexts;
    if (copiedOrigianlPaperId !== "") update.copiedOrigianlPaperId = copiedOrigianlPaperId;
    update.paperIndex = paperIndex;
    if (color.r !== 0 || color.g !== 0 || color.b !== 0 || color.a !== 0) update.color = color;
    if (noteType !== "") update.noteType = noteType;
    if (startPaperId !== "") update.startPaperId = startPaperId;
    if (endPaperId !== "") update.endPaperId = endPaperId;
    update.labelPosIndex = labelPosIndex;
    update.scaleFactor = scaleFactor;

    // console.log(update.highlightTexts);

    try {
      const updatedData = await Data.findOneAndUpdate({ _id: _id }, { $set: update }, { new: true });

      if (!updatedData) {
        return res.status(404).json({ status: 'error', message: 'Data not found' });
      }
      res.status(200).json({ status: 'ok', message: 'Data updated successfully' });
    } catch (error) {
      return res.status(404).json({ status: 'error', message: 'Id not found' });
    }
  } catch (error) {
    console.error('Failed to update data:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update data', data: error });
  }
});

app.post("/delete-data", async (req, res) => {
  const { _projectName, _id } = req.body;

  try {
    await connectToDatabase(_projectName);
    const Data = mongoose.model('Data', dataSchema, 'SaveFile');

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid ID format' });
    }

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
