const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const sharp = require('sharp');
const path = require('path');
const redis = require('redis');
const fs = require('fs');
const app = express();
const port = 8080;

const client = redis.createClient();
(async () => {
  try {
    await  client.connect();  
  } catch (err) {
    console.log(err);
  }
})();
client.on("error", function (error) {
  console.error("Redis Error: ", error);
});
//replace with our file storage means

const upload = multer({ storage: storage });

//static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadToRedis = (req, res, next) => {
    let chunks = [];
    req.on('data', (chunk) => {
        chunks.push(chunk);
    });

    req.on('end', () => {
        const fileBuffer = Buffer.concat(chunks);
        client.set(req.headers.filename, fileBuffer, 'EX', 300, (err) => {
            if (err) {
                return res.status(500).send('Failed to upload to Redis.');
            }
            next();
        });
    });
};

app.post('/upload', uploadToRedis, (req, res) => {
    res.status(200).send('File uploaded successfully.');
});

app.post('/upload-image', uploadToRedis, async (req, res) => {
    const filename = req.headers.filename;
    
    client.get(filename, async (err, fileBuffer) => {
        if (err || !fileBuffer) {
            return res.status(400).send('No file uploaded.');
        }
        
        const outputPath = `uploads/compressed_${filename}`;
        
        try {
            await sharp(fileBuffer)
                .resize(800) //change size
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
});

app.post('/upload-zip', uploadToRedis, (req, res) => {
    const filename = req.headers.filename;
    
    client.get(filename, (err, fileBuffer) => {
        if (err || !fileBuffer) {
            return res.status(400).send('No file uploaded.');
        }
        
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename=compressed_${filename}.zip`
        });
        
        archive.on('error', (err) => res.status(500).send({ error: err.message }));
        archive.pipe(res);
        archive.append(fileBuffer, { name: filename });
        archive.finalize();
    });
});

app.post('/upload-tar', uploadToRedis, (req, res) => {
    const filename = req.headers.filename;
    
    client.get(filename, (err, fileBuffer) => {
        if (err || !fileBuffer) {
            return res.status(400).send('No file uploaded.');
        }
        
        const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
        res.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename=compressed_${filename}.tar.gz`
        });
        
        archive.on('error', (err) => res.status(500).send({ error: err.message }));
        archive.pipe(res);
        archive.append(fileBuffer, { name: filename });
        archive.finalize();
    });
});

const zipAndCacheFile = (req, res, fileType, extension) => {
    const outputPath = `uploads/compressed_${req.file.filename}.${extension}`;

    client.get(outputPath, (err, reply) => {
        if (reply) {
            // Compressed file is cached, serve the cached file
            res.download(reply);
        } else {
            const archive = archiver(fileType, { zlib: { level: 9 } });
            res.writeHead(200, {
                'Content-Type': `application/${extension}`,
                'Content-Disposition': `attachment; filename=compressed_${req.file.filename}.${extension}`
            });

            archive.on('error', (err) => res.status(500).send({ error: err.message }));
            archive.pipe(res);
            archive.file(req.file.path, { name: req.file.filename });
            archive.finalize();

            // Cache the path of the compressed file in Redis
            client.set(outputPath, outputPath, 'EX', 3600); // Cache expires in 1 hour
        }
    });
};

//start server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
