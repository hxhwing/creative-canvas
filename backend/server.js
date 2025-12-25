const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const sizeOf = require('image-size');
const { understandPrompt, generateImagePrompt, generateVideoPrompt } = require('./prompts');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const crypto = require('crypto');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'hxhdemo'
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const MODEL_NAME = 'gemini-2.5-flash-lite';
const IMAGE_MODEL_NAME = 'gemini-3-pro-image-preview';
const VIDEO_MODEL_ID = "veo-3.1-generate-001";
const API_ENDPOINT = "us-central1-aiplatform.googleapis.com";
const FIRESTORE_DB = "creative-canvas";
const BUCKET = "hxhdemo-hk";
const PREFIX = "creative-canvas";


// --- App Setup ---
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Cloud Clients ---
const firestore = new Firestore({
    projectId: GOOGLE_CLOUD_PROJECT,
    databaseId: FIRESTORE_DB
});
const storage = new Storage({
    projectId: GOOGLE_CLOUD_PROJECT
});
const bucket = storage.bucket(BUCKET);

// --- Google Auth ---
async function getAccessToken() {
    const auth = new GoogleAuth({
        projectId: GOOGLE_CLOUD_PROJECT,
        scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    return accessToken.token;
}

function getAuthenticatedUser(req) {
    const userIdHeader = req.headers['x-goog-authenticated-user-id'];
    const userEmailHeader = req.headers['x-goog-authenticated-user-email'];

    if (userIdHeader) {
        return {
            id: userIdHeader.replace('accounts.google.com:', ''),
            email: userEmailHeader ? userEmailHeader.replace('accounts.google.com:', '') : 'unknown'
        };
    }

    return {
        id: 'guest',
        email: 'guest@example.com'
    };
}




// --- API Endpoint ---
app.post('/api/understand', async (req, res) => {
    try {
        const { imageData, style, notes } = req.body;
        if (!imageData) {
            return res.status(400).json({ error: 'imageData is required' });
        }

        const accessToken = await getAccessToken();
        const apiUrl = `https://aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/publishers/google/models/${MODEL_NAME}:generateContent`;

        let finalPrompt = understandPrompt;
        if (style && style !== 'auto') {
            finalPrompt = `User only accepts this style: ${style}\n\n${finalPrompt}`;
        }
        if (notes) {
            finalPrompt = `${finalPrompt}\n\nSupplementary notes from the user: ${notes}`;
        }


        const payload = {
            contents: [{
                role: "user",
                parts: [{
                    text: finalPrompt
                },
                {
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: imageData
                    }
                }]
            }],
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 1,
                thinkingConfig: { thinkingBudget: 0 },
                responseMimeType: "application/json",
            }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`API request failed with status: ${response.status}. Body: ${errorBody}`);
            throw new Error(`API request failed with status: ${response.status}.`);
        }

        const result = await response.json();
        const candidate = result.candidates?.[0];

        if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0].text) {
            throw new Error(`Could not find valid text in the API response. Response: ${JSON.stringify(result)}`);
        }

        const responseText = candidate.content.parts[0].text;
        try {
            // The response from Gemini might include markdown fences for JSON
            const jsonText = responseText.replace(/^```json\s*/, '').replace(/```$/, '');
            const responseObject = JSON.parse(jsonText);

            res.json(responseObject);
        } catch (parseError) {
            console.error('Error parsing JSON from Gemini response:', parseError, 'Raw text:', responseText);
            // If parsing fails, send the raw text back for debugging
            res.status(500).json({ error: 'Failed to parse response from AI', details: responseText });
        }

    } catch (error) {
        console.error('Error in /api/understand endpoint:', error);
        res.status(500).json({ error: 'Failed to call Vertex AI API', details: error.message });
    }
});



app.post('/api/generate', async (req, res) => {
    try {
        const { imageData, prompt } = req.body;
        const user = getAuthenticatedUser(req);

        if (!imageData) {
            return res.status(400).json({ error: 'imageData is required' });
        }

        // --- Call Vertex AI ---
        const accessToken = await getAccessToken();
        const payload = {
            contents: [{
                role: "user",
                parts: [{ text: prompt || generateImagePrompt }, { inlineData: { mimeType: "image/jpeg", data: imageData } }]
            }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.5, responseModalities: ["TEXT", "IMAGE"] }
        };

        const modelToUse = req.body.model || IMAGE_MODEL_NAME;
        const apiUrl = `https://aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/publishers/google/models/${modelToUse}:generateContent`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${accessToken}` },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`API request failed with status: ${response.status}. Body: ${errorBody}`);
            throw new Error(`API request failed with status: ${response.status}.`);
        }

        const result = await response.json();
        const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

        if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
            throw new Error(`Could not find valid image data in the API response. Response: ${JSON.stringify(result)}`);
        }

        // --- Return generated image to client ---
        res.json({ parts: [imagePart] });

    } catch (error) {
        console.error('Error in /api/generate endpoint:', error);
        res.status(500).json({ error: 'Failed to generate or save image', details: error.message });
    }
});

app.post('/api/save-creation', async (req, res) => {
    try {
        const { drawingData, generatedData, prompt, cn_description, cn_style } = req.body;
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        if (!drawingData || !generatedData) {
            return res.status(400).json({ message: 'drawingData and generatedData are required.' });
        }

        // --- Save to GCS and Firestore ---
        const creationId = crypto.randomBytes(3).toString('hex');
        const drawingPath = `${PREFIX}/${userId}/${creationId}/drawing.png`;
        const imagePath = `${PREFIX}/${userId}/${creationId}/image.png`;

        const uploadImage = async (path, data) => {
            const buffer = Buffer.from(data, 'base64');
            const file = bucket.file(path);
            await file.save(buffer, { contentType: 'image/png' });
            return `gs://${BUCKET}/${path}`;
        };

        const [drawing_url, image_url] = await Promise.all([
            uploadImage(drawingPath, drawingData),
            uploadImage(imagePath, generatedData)
        ]);

        await firestore.collection('users').doc(userId).collection('creations').doc(creationId).set({
            drawing_url,
            image_url,
            image_prompt: prompt || generateImagePrompt,
            cn_description: cn_description || null,
            cn_style: cn_style || null,
            timestamp: FieldValue.serverTimestamp()
        });

        res.status(201).json({ creationId: creationId, message: 'Creation saved successfully.' });

    } catch (error) {
        console.error('Error in /api/save-creation endpoint:', error);
        res.status(500).json({ message: 'Failed to save creation.', error: error.message });
    }
});

app.post('/api/generate-video', async (req, res) => {
    try {
        const { imageData, prompt, creationId } = req.body;
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        if (!imageData || !creationId) {
            return res.status(400).json({ error: 'imageData and creationId are required' });
        }


        // Determine aspect ratio from image dimensions
        const imageBuffer = Buffer.from(imageData, 'base64');
        const dimensions = sizeOf.imageSize(imageBuffer);
        const aspectRatio = dimensions.width > dimensions.height ? '16:9' : '9:16';



        const accessToken = await getAccessToken();
        const videoModelToUse = req.body.model || VIDEO_MODEL_ID;
        const predictApiUrl = `https://${API_ENDPOINT}/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/${videoModelToUse}:predictLongRunning`;

        const predictPayload = {
            "instances": [{
                "prompt": prompt || generateVideoPrompt,
                "image": {
                    "bytesBase64Encoded": imageData,
                    "mimeType": "image/jpeg",
                },
            }],
            "parameters": {
                "aspectRatio": aspectRatio,
                "sampleCount": 1,
                "durationSeconds": "8",
                "personGeneration": "allow_all",
                "addWatermark": true,
                "includeRaiReason": true,
                "generateAudio": true,
                "resolution": "720p",
                "storageUri": `gs://${BUCKET}/${PREFIX}/${userId}/${creationId}/`,
            }
        };

        const predictResponse = await fetch(predictApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify(predictPayload)
        });

        if (!predictResponse.ok) {
            const errorBody = await predictResponse.text();
            console.error(`Predict API request failed with status: ${predictResponse.status}. Body: ${errorBody}`);
            throw new Error(`Predict API request failed with status: ${predictResponse.status}.`);
        }

        const predictResult = await predictResponse.json();
        const operationName = predictResult.name;

        if (!operationName) {
            throw new Error('Could not get operation name from predict response.');
        }

        // Immediately return the operation name to the client
        res.json({ operationName: operationName });

    } catch (error) {
        console.error('Error in /api/generate-video endpoint:', error);
        res.status(500).json({ error: 'Failed to start Video Generation API job', details: error.message });
    }
});

app.post('/api/video-status', async (req, res) => {
    try {
        const { operationName, creationId, prompt } = req.body;
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        if (!operationName || !creationId) {
            return res.status(400).json({ error: 'operationName and creationId are required' });
        }

        const accessToken = await getAccessToken();
        const fetchApiUrl = `https://${API_ENDPOINT}/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/${VIDEO_MODEL_ID}:fetchPredictOperation`;
        const fetchPayload = { "operationName": operationName };

        const fetchResponse = await fetch(fetchApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify(fetchPayload)
        });

        if (!fetchResponse.ok) {
            const errorBody = await fetchResponse.text();
            console.error(`Fetch API request failed with status: ${fetchResponse.status}. Body: ${errorBody}`);
            throw new Error(`Polling for video generation failed: ${errorBody}`);
        }

        const fetchResult = await fetchResponse.json();

        if (!fetchResult.done) {
            return res.json({ status: 'processing' });
        }

        if (fetchResult.error) {
            throw new Error(`Video generation completed with an error: ${JSON.stringify(fetchResult.error)}`);
        }

        const videoResult = fetchResult.response;
        const gcsUri = videoResult.videos?.[0]?.gcsUri;
        if (!gcsUri) {
            throw new Error('No GCS URI found in the successful video generation response.');
        }

        // --- Update Firestore ---
        await firestore.collection('users').doc(userId).collection('creations').doc(creationId).update({
            video_url: gcsUri,
            video_prompt: prompt || generateVideoPrompt,
        });

        // --- Generate Signed URL for client ---
        const getSignedUrl = async (gsPath) => {
            if (!gsPath) return null;
            const urlParts = gsPath.replace('gs://', '').split('/');
            const bucketName = urlParts.shift();
            const filePath = urlParts.join('/');
            const [signedUrl] = await storage.bucket(bucketName).file(filePath).getSignedUrl({
                action: 'read',
                expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            });
            return signedUrl;
        };

        const signedVideoUrl = await getSignedUrl(gcsUri);

        res.json({ status: 'completed', videoUrl: signedVideoUrl });

    } catch (error) {
        console.error('Error in /api/video-status endpoint:', error);
        res.status(500).json({ error: 'Failed to check video status', details: error.message });
    }
});


app.get('/api/user', async (req, res) => {
    try {
        const user = getAuthenticatedUser(req);
        const { email: userEmail, id: userId } = user;

        const userRef = firestore.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            await userRef.set({
                userEmail: userEmail,
                created_at: FieldValue.serverTimestamp()
            });
        }

        res.json({
            email: userEmail,
            id: userId
        });
    } catch (error) {
        console.error('Error in /api/user endpoint:', error);
        res.status(500).json({ error: 'Failed to process user information', details: error.message });
    }
});

app.get('/api/creations', async (req, res) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        const creationsRef = firestore.collection('users').doc(userId).collection('creations');
        const snapshot = await creationsRef.orderBy('timestamp', 'desc').get();

        if (snapshot.empty) {
            return res.json([]);
        }

        const getSignedUrl = async (gsPath) => {
            if (!gsPath) return null;
            const urlParts = gsPath.replace('gs://', '').split('/');
            const bucketName = urlParts.shift();
            const filePath = urlParts.join('/');
            const [signedUrl] = await storage.bucket(bucketName).file(filePath).getSignedUrl({
                action: 'read',
                expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            });
            return signedUrl;
        };

        const creations = await Promise.all(snapshot.docs.map(async (doc) => {
            const data = doc.data();
            const [drawingUrl, imageUrl, videoUrl] = await Promise.all([
                getSignedUrl(data.drawing_url),
                getSignedUrl(data.image_url),
                getSignedUrl(data.video_url)
            ]);
            return {
                id: doc.id,
                timestamp: data.timestamp.toDate(),
                drawingUrl: drawingUrl,
                imageUrl: imageUrl,
                videoUrl: videoUrl,
            };
        }));

        res.json(creations);

    } catch (error) {
        console.error('Error in /api/creations endpoint:', error);
        res.status(500).json({ error: 'Failed to fetch creations', details: error.message });
    }
});

app.delete('/api/creations', async (req, res) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        const { creationIds } = req.body;
        if (!Array.isArray(creationIds) || creationIds.length === 0) {
            return res.status(400).json({ message: 'creationIds must be a non-empty array.' });
        }

        const deletePromises = creationIds.map(async (creationId) => {
            // 1. Delete GCS folder
            const prefix = `${PREFIX}/${userId}/${creationId}/`;
            await bucket.deleteFiles({ prefix: prefix });

            // 2. Delete Firestore document
            const docRef = firestore.collection('users').doc(userId).collection('creations').doc(creationId);
            await docRef.delete();
        });

        await Promise.all(deletePromises);

        res.status(200).json({ message: `${creationIds.length} creation(s) deleted successfully.` });

    } catch (error) {
        console.error('Error deleting creations:', error);
        res.status(500).json({ message: 'An error occurred while deleting creations.', error: error.message });
    }
});


// --- Serve Frontend ---
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log('Remember to set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.');
    console.log(`Serving frontend from: ${path.join(__dirname, '../frontend')}`);
});
