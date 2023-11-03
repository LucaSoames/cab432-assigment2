const express = require('express');
const bodyParser = require('body-parser');
const redis = require('redis');
const AWS = require('aws-sdk');
const busboy = require('busboy');
const sharp = require('sharp');
const archiver = require('archiver');
const fs = require('fs');
const cors = require('cors');
const formidable = require('express-formidable');
require("dotenv").config();

const app = express();
app.use(cors());

//aws set up
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
  region: process.env.REGION,
});
// S3 setup
const s3 = new AWS.S3();
const BUCKET_NAME =  process.env.S3_BUCKET_NAME;
//redis setup
const redisClient = redis.createClient();
(async () => {
    try {
        await  redisClient.connect();  
    } catch (err) {
        console.log(err);
    }
})();
redisClient.on("error", function (error) {
    console.error("Redis Error: ", error);
});


//define the size threshold for storing files in Redis vs. S3 (in bytes)
const SIZE_THRESHOLD = 10 * 1024 * 1024; // Size in bytes 10mb

//endpoint for ZIP compression
app.post('/upload-zip', (req, res) => {
    try {
        handleArchive(req, res, 'zip');
    } catch (error) {
        res.status(500).send('Error handling files.');
    }
});

//endpoint for TAR.GZ compression
app.post('/upload-tar', (req, res) => {
    try {
        handleArchive(req, res, 'tar');
    } catch (error) {
        res.status(500).send('Error handling files.')
    }
});


function handleArchive(req, res, format) {
    const bb = busboy({ headers: req.headers });
    const filePromises = [];

    bb.on('file', (fieldname, file, originalFilename) => {
        const filename = `${format}:${originalFilename.filename}`;
        const filePromise = new Promise(async (resolve, reject) => {
          let fileBuffer = Buffer.alloc(0);
    
          file.on('data', (data) => {
            fileBuffer = Buffer.concat([fileBuffer, data]);
          });
    
          file.on('end', async () => {
            try {
              //first check if the file exists in S3
              const existsInS3 = await checkS3ForKey(filename);
              if (existsInS3) {
                //if it exists in S3, resolve with the S3 URL
                const params = {
                    Bucket: BUCKET_NAME,
                    Key: filename
                  };
                const data = await s3.getObject(params).promise();
                resolve(data.Body);
              } else {
                // if it's not in S3, check in Redis
                const cachedFile = await redisClient.get(filename);
                if (cachedFile) {
                  //if cached in Redis, resolve with the cached buffer
                  resolve(Buffer.from(cachedFile, 'base64'));
                } else {
                  //if not in Redis and it's larger than the threshold, upload to S3
                  if (fileBuffer.length > SIZE_THRESHOLD) {
                    const s3Url = await uploadToS3(filename, fileBuffer);
                    resolve(fileBuffer);
                  } else {
                    //if smaller than the threshold, save to Redis
                    await redisClient.setEx(filename, 3600, fileBuffer.toString('base64'));
                    resolve(fileBuffer);
                  }
                }
              }
            } catch (err) {
                res.status(500).send('Archive error.');
                reject(err);
            }
          });
    
          file.on('error', (err) => {
            res.status(500).send('Archive error.');
            reject(err);
          });
        });
    
        filePromises.push(filePromise.then(buffer => ({ name: originalFilename.filename, file: buffer })));
      });

    bb.on('finish', async () => {
        try {
            const files = await Promise.all(filePromises);
            const archive = archiver(format, { zlib: { level: 9 } });

            files.forEach((fileObj) => {
                archive.append(fileObj.file, { name: fileObj.name });
            });

            archive.on('end', () => console.log('Archive wrote all data'));
            archive.on('error', (err) => res.status(500).send('Archive error.'));

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="compressed.${format}"`);

            archive.finalize();
            archive.pipe(res);
        } catch (error) {
            console.error('Error during file compression:', error);
            res.status(500).send('Failed to compress and download files.');
        }
    });

    req.pipe(bb);
}

async function checkS3ForKey(key) {
    const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    };

    try {
    await s3.headObject(params).promise();
    //if no error is thrown, the object exists in S3
    return true;
    } catch (err) {
    //if a NotFound error is thrown, the object does not exist in S3
    if (err.code === 'NotFound') {
        return false;
    }
    //re-throw other errors
    throw err;
    }
}

async function uploadToS3(key, buffer) {
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg' // Or determine the content type dynamically
    };
  
    const uploadResult = await s3.upload(params).promise();
    return uploadResult.Location;
}

app.post('/upload-image', (req, res) => {
    try {        
        const bb = busboy({ headers: req.headers });
    
        bb.on('file', async (fieldname, file, filename, encoding, mimetype) => {
            //first check if the file exists in S3
            const existsInS3 = await checkS3ForKey(filename.filename);
            if (existsInS3) {
                //if it exists in S3, resolve with the S3 URL
                const params = {
                    Bucket: BUCKET_NAME,
                    Key: filename.filename
                    };
                const data = await s3.getObject(params).promise();
                res.send(data.Body);
            } else {
                // if it's not in S3, check in Redis
                const cachedFile = await redisClient.get(filename.filename);
                if (cachedFile) {
                    //if cached in Redis, resolve with the cached buffer
                    return res.send(Buffer.from(cachedFile, 'base64'));
                } else {
                    //if not in Redis and it's larger than the threshold, upload to S3
                    const resizeTransform = sharp().resize(800);
                    const processedImageStream = file.pipe(resizeTransform); 
                    const processedImageBuffer = await streamToBuffer(processedImageStream);
                    if (processedImageBuffer.length > SIZE_THRESHOLD) {
                        const s3Url = await uploadToS3(filename.filename, processedImageBuffer);
                        res.send(processedImageBuffer);
                    } else {
                        const string =  processedImageBuffer.toString('base64');
                        await redisClient.setEx(filename.filename, 60, string);
                        //send the processed image as the response
                        res.send(processedImageBuffer);
                    }
                }
            }
        });    
        req.pipe(bb);
    } catch (error) {
        res.status(500).send('Failed to compress and download files.');
    }
});
app.post('/upload-multiple-images', (req, res) => {
    try {        
        const bb = busboy({ headers: req.headers });
        const filePromises = [];
    
        bb.on('file', (fieldname, file, originalFilename) => {
            const filename = `sizeCompress:${originalFilename.filename}`; // Use the filename directly
            const filePromise = new Promise((resolve, reject) => {
                let fileBuffer = Buffer.alloc(0);
        
                file.on('data', (data) => {
                    fileBuffer = Buffer.concat([fileBuffer, data]);
                });
        
                file.on('end', async () => {
                    try {
                        const existsInS3 = await checkS3ForKey(filename);
                        if (existsInS3) {
                          //if it exists in S3, resolve with the S3 URL
                          const params = {
                              Bucket: BUCKET_NAME,
                              Key: filename
                            };
                          const data = await s3.getObject(params).promise();
                          resolve({name: originalFilename.filename, file: data.Body});
                        } else {
                          // if it's not in S3, check in Redis
                          const cachedFile = await redisClient.get(filename);
                          if (cachedFile) {
                            //if cached in Redis, resolve with the cached buffer
                            resolve({ name: originalFilename.filename, file: Buffer.from(cachedFile, 'base64') });
                          } else {
                              const processedImageBuffer = await sharp(fileBuffer).resize(800).toBuffer();
                              //if not in Redis and it's larger than the threshold, upload to S3
                            if (processedImageBuffer.length > SIZE_THRESHOLD) {
                              const s3Url = await uploadToS3(filename, processedImageBuffer);
                              resolve({ name: originalFilename.filename, file: processedImageBuffer});
                            } else {
                              //if smaller than the threshold, save to Redis
                              await redisClient.setEx(filename, 3600, processedImageBuffer.toString('base64'));
                              resolve({ name: originalFilename.filename, file: processedImageBuffer});
                            }
                          }
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
        
                file.on('error', (err) => {
                    reject(err);
                });
            });
        
            filePromises.push(filePromise);
        });
        
    
        bb.on('finish', async () => {
            try {
                const files = await Promise.all(filePromises);
                const archive = archiver('zip', { zlib: { level: 9 } });
    
                files.forEach((fileObj) => {
                    archive.append(fileObj.file, { name: fileObj.name });
                });
    
                archive.on('end', () => console.log('Archive wrote all data'));
                archive.on('error', (err) => res.status(500).send('Archive error.'));
    
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="compressed.zip"`);
    
                archive.finalize();
                archive.pipe(res);
            } catch (error) {
                console.error('Error during file compression:', error);
                res.status(500).send('Failed to compress and download files.');
            }
        });
    
        req.pipe(bb);
    } catch (error) {
        res.status(500).send('Error uploading multiple files.');
    }
});

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', res.status(500).send('Error uploading multiple files.'));
    });
}

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
