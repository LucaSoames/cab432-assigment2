import React, { useState } from 'react';
import axios from 'axios';
import { Button, Form, Alert } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

function FileUpload() {
    const [file, setFile] = useState(null);
    const [compressionType, setCompressionType] = useState('');
    const [uploadStatus, setUploadStatus] = useState('');

    const onFileChange = (event) => {
        setFile(event.target.files[0]);
    };

    const onCompressionTypeChange = (event) => {
        setCompressionType(event.target.value);
    };

    const onFormSubmit = async (event) => {
        event.preventDefault();
        debugger;
        let endpoint = '';
        switch (compressionType) {
            case 'zip':
                endpoint = '/upload-zip';
                break;
            case 'tar':
                endpoint = '/upload-tar';
                break;
            case 'image':
                endpoint = '/upload-image';
                break;
            default:
                setUploadStatus('Please select a valid compression type.');
                return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await axios.post(`http://localhost:8080${endpoint}`, formData, {
                responseType: 'blob', // to handle binary data
            });
            debugger;
            const downloadUrl = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', `compressed_${file.name}`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            setUploadStatus('File uploaded and compressed successfully.');
        } catch (error) {
            setUploadStatus('Failed to upload and compress file.');
        }
    };

    return (
        <div className="container mt-5">
            <Form onSubmit={onFormSubmit}>
                <Form.Group controlId="formFile" className="mb-3">
                    <Form.Label>Choose a file to upload</Form.Label>
                    <Form.Control type="file" onChange={onFileChange} />
                </Form.Group>

                <Form.Group controlId="compressionType" className="mb-3">
                    <Form.Label>Select Compression Type</Form.Label>
                    <Form.Select onChange={onCompressionTypeChange}>
                        <option value="" disabled selected>Select a compression type</option>
                        <option value="zip">ZIP</option>
                        <option value="tar">Tar.gz (Ubuntu/Mac)</option>
                        {file && file.type.startsWith('image/') && <option value="image">Image Compression</option>}
                    </Form.Select>
                </Form.Group>

                <Button variant="primary" type="submit">
                    Upload
                </Button>
            </Form>
            {uploadStatus && <Alert className="mt-3">{uploadStatus}</Alert>}
        </div>
    );
}

export default FileUpload;
