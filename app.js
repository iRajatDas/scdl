const express = require("express");
const scdl = require("soundcloud-downloader").default;
const crypto = require("crypto");
const bodyParser = require("body-parser");

const CLIENTS = [
  {
    id: "SkNjMmSOqCCKdQohdskaTGJvEncaJpga",
    last_accessed: 1635734400,
    is_working: true,
  },
  {
    id: "6IJeivvH0BePX4XIsvLxxdmCIhBDUB0m", // mine
    last_accessed: 1635734400,
    is_working: true,
  },
];

const SECRET_KEY = "SECRET_2";
const CLIENT_ID = CLIENTS.filter((client) => client.is_working)[
  crypto.randomInt(0, CLIENTS.length)
].id;

function signUrl(path, params) {
  const expiresIn = 100; // Expiration time in seconds
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn; // Current timestamp in seconds + 10 seconds
  params.expires = expiresAt;

  const originalUrl = `${path}?${new URLSearchParams(params).toString()}`;
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
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
    .createHmac("sha256", SECRET_KEY)
    .update(urlWithoutSignature)
    .digest("hex");

  if (receivedSignature === expectedSignature) {
    return next();
  } else {
    return res.status(401).send("Invalid signature");
  }
}

async function getStream({
  url,
  clientId = CLIENT_ID,
  isStreamRequired = false,
}) {
  if (!url) {
    return {
      stream: null,
      details: null,
      message: "URL parameter is missing",
    };
  }

  scdl.setClientID(clientId);
  try {
    const details = await scdl.getInfo(url);
    if (isStreamRequired) {
      const stream = await scdl.downloadFormat(url, scdl.FORMATS.MP3);
      return { stream, details };
    }

    CLIENTS.find((client) => client.id === clientId).last_accessed = Math.floor(
      Date.now() / 1000
    );

    CLIENTS.sort((a, b) => a.last_accessed - b.last_accessed);

    // is working
    CLIENTS.find((client) => client.id === clientId).is_working = true;

    return {
      stream: null,
      details,
      message: "Success",
    };
  } catch (error) {
    console.error("Failed to get stream:", error);
    return {
      stream: null,
      details: null,
      message: "Failed to get stream",
    };
  }
}

const app = express();
app.use(bodyParser.json());

app.post("/getInfo", async (req, res) => {
  const { url, clientId } = req.body;
  console.log("URL:", url);
  const { details } = await getStream({ url });

  if (!details) {
    return res.status(500).json({
      message:
        "Woops! Something went wrong with the request; Please report us!",
    });
  }

  let uri = null;
  // if media.transcodings is present, it means the track is downloadable
  if (details.media && details.media.transcodings) {
    const downloadUrl = details.media.transcodings.filter(
      (item) => item.format.mime_type === "audio/mpeg"
    );
    if (downloadUrl.length > 0) {
      uri = downloadUrl[0].url;
    }
  }

  const selfDownloadTrack = signUrl(`/downloadTrack`, {
    url: url,
  });

  res.status(200).json(
    uri
      ? {
          title: details.title,
          art_work: details.artwork_url,
          uri: selfDownloadTrack,
          message: "Track is downloadable",
        }
      : {
          title: null,
          art_work: null,
          uri: null,
          message: "Track is not downloadable",
        }
  );
});

app.get("/downloadTrack", verifySignature, async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("URL parameter is missing");
  }

  const { stream, details } = await getStream({ url, isStreamRequired: true });
  if (!stream) {
    return res.status(500).json({
      message:
        "Woops! Something went wrong with the request; Please report us!",
    });
  }

  if (details) {
  }

  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Disposition": 'attachment; filename="track.mp3"',
  });

  stream.pipe(res);
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
