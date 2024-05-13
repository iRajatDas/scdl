const express = require("express");
const fs = require("fs");
const scdl = require("soundcloud-downloader").default;
const axios = require("axios");
const crypto = require("crypto");
const bodyParser = require("body-parser");

const NodeCache = require("node-cache");
const myCache = new NodeCache({ stdTTL: 10, checkperiod: 120 }); // TTL in seconds, check period in seconds

const secretKey = "SECRET_2"; // Keep this secure and do not hard-code in production

function signUrl(path, params) {
  const expiresIn = 10; // Expiration time in seconds
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn; // Current timestamp in seconds + 10 seconds
  params.expires = expiresAt;

  const originalUrl = `${path}?${new URLSearchParams(params).toString()}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(originalUrl)
    .digest("hex");
  return `${originalUrl}&signature=${signature}`;
}

function verifySignature(req, res, next) {
  const url = `${req.path}?${new URLSearchParams(req.query).toString()}`;
  const receivedSignature = req.query.signature;
  const expiresAt = req.query.expires;

  // Check if the URL has expired
  if (!expiresAt || Date.now() / 1000 > parseInt(expiresAt)) {
    return res.status(401).send("URL has expired");
  }

  // Reconstruct the original signed URL by removing the signature
  const urlWithoutSignature = url.slice(0, url.lastIndexOf("&"));

  const expectedSignature = crypto
    .createHmac("sha256", secretKey)
    .update(urlWithoutSignature)
    .digest("hex");

  if (receivedSignature === expectedSignature) {
    return next();
  } else {
    return res.status(401).send("Invalid signature");
  }
}

const SOUNDCLOUD_URL =
  "https://soundcloud.com/trillfuturepromos/jigz-out-of-time-original-mix";
const CLIENT_ID = "6IJeivvH0BePX4XIsvLxxdmCIhBDUB0m";
const SECRET_KEY = "your-secret-key";

scdl.setClientID(CLIENT_ID); // Set the client ID globally if applicable for all calls

async function getStream() {
  const details = await scdl.getInfo(SOUNDCLOUD_URL);
  const stream = await scdl.downloadFormat(SOUNDCLOUD_URL, scdl.FORMATS.MP3);
  return { stream, details };
}

async function streamToFile() {
  try {
    const { stream, details } = await getStream();
    const { title, artwork_url, id } = details;
    console.table({ title, artwork_url, id });
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, "_");
    const writeStream = fs.createWriteStream(`${sanitizedTitle}.mp3`);
    stream.pipe(writeStream);
  } catch (error) {
    console.error("Failed to stream to file:", error);
  }
}

const app = express();
app.use(bodyParser.json());

app.get("/download", async (req, res) => {
  if (!req.query.url) {
    return res.status(400).send("URL parameter is missing");
  }

  try {
    const urlParam = new URL(decodeURIComponent(req.query.url));
    urlParam.searchParams.set("client_id", CLIENT_ID);

    console.log(`Fetching URL: ${urlParam.href}`);

    const getFile = await axios.get(urlParam.href);
    const m3u8Response = await axios.get(getFile.data.url, {
      responseType: "stream",
    });

    if (!m3u8Response.headers["content-type"].startsWith("audio/mpegurl")) {
      return res.status(500).send("Invalid content type");
    }

    const m3u8Text = await streamToString(m3u8Response.data);
    const segmentUrls = m3u8Text
      .split("\n")
      .filter((line) => line.startsWith("https://"));

    if (segmentUrls.length === 0) {
      return res.status(500).send("No segment URLs found in the m3u8 file");
    }

    const expirationTime = Date.now() + 3600000; // 1 hour from now

    const downloadUrl = signUrl(
      `http://example.com/stream?url=${encodeURIComponent(urlParam.href)}`,
      expirationTime
    );

    res.status(200).json({
      downloadUrl,
      expiresAt: expirationTime,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred");
  }
});

app.get("/stream", async (req, res) => {
  if (!verifySignedUrl(req.url)) {
    return res.status(403).send("Invalid or expired download link");
  }

  try {
    const urlParam = req.query.url;
    const getFile = await axios.get(decodeURIComponent(urlParam));
    const m3u8Response = await axios.get(getFile.data.url, {
      responseType: "stream",
    });

    if (!m3u8Response.headers["content-type"].startsWith("audio/mpegurl")) {
      return res.status(500).send("Invalid content type");
    }

    const m3u8Text = await streamToString(m3u8Response.data);
    const segmentUrls = m3u8Text
      .split("\n")
      .filter((line) => line.startsWith("https://"));

    if (segmentUrls.length === 0) {
      return res.status(500).send("No segment URLs found in the m3u8 file");
    }

    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Content-Disposition": 'attachment; filename="audio.mp3"',
    });

    for (const segmentUrl of segmentUrls) {
      const segmentResponse = await axios.get(segmentUrl, {
        responseType: "stream",
      });
      segmentResponse.data.pipe(res, { end: false });
    }

    res.on("finish", () => res.end());
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred");
  }
});

// Helper function to convert stream to string
function streamToString(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

app.get("/protected", verifySignature, (req, res) => {
  const key = `response-${req.originalUrl}`; // Unique key for caching, based on the URL

  // Try to get data from cache
  const cachedData = myCache.get(key);
  if (cachedData) {
    console.log("Cache hit");
    return res.send(cachedData); // Send cached response
  }

  // If not in cache, process and store result
  const data = "This is a protected route"; // Replace with actual data processing
  myCache.set(key, data, 10); // Cache the result with a TTL of 10 seconds

  console.log("Cache miss, data processed");
  res.send(data);
});

// Example of generating a signed URL
app.get("/generate-signed-url", (req, res) => {
  const url = req.query.url;

  const params = { param1: "value1" }; // Your parameters for signing
  const key = `signed-url-${JSON.stringify(params)}`; // Unique key for caching, based on parameters

  // Try to get the signed URL from cache
  const cachedUrl = myCache.get(key);
  if (cachedUrl) {
    console.log("Cached URL used");
    return res.send(`Visit this URL: ${cachedUrl}`);
  }

  // If not in cache, generate, store, and send the signed URL
  const signedUrl = signUrl("/protected", params);
  myCache.set(key, signedUrl, 10); // Cache the URL with a TTL of 10 seconds

  console.log("URL generated and cached");
  res.send(`Visit this URL: ${signedUrl}`);
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
