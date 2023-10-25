const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const sharp = require('sharp');
const path = require('path');
const app = express();
const port = 3000;

//replace with our file storage means
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

//static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

//endpoint to handle file uploads
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    res.status(200).send('File uploaded successfully.');
});

//upload and compress image files
app.post('/upload-image', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    
    const outputPath = `uploads/compressed_${req.file.filename}`;

    try {
        await sharp(req.file.path)
            .resize(800) // Adjust resizing as necessary
            .toFile(outputPath, (err, info) => {
                if (err) {
                    throw err;
                }
                res.download(outputPath);
            });
    } catch (error) {
        res.status(500).send('Failed to compress image.');
    }
});

app.post('/upload-zip', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=compressed_${req.file.filename}.zip`
    });
    
    archive.on('error', (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    archive.file(req.file.path, { name: req.file.filename });
    archive.finalize();
});

app.post('/upload-tar', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
    res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename=compressed_${req.file.filename}.tar.gz`
    });
    
    archive.on('error', (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    archive.file(req.file.path, { name: req.file.filename });
    archive.finalize();
});

//start server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
