addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Get the URL parameter from the request
  const urlParam = new URL(request.url).searchParams.get("url");
  const outputType = new URL(request.url).searchParams.get("outputType");
  console.log(outputType);

  if (!urlParam) {
    return new Response("URL parameter is missing", { status: 400 });
  }

  // Fetch the m3u8 file
  const getFile = await fetch(decodeURIComponent(urlParam));
  const file = await getFile.json();

  // Fetch the m3u8 playlist
  const m3u8Response = await fetch(file.url);

  // Check the content type of the response
  const contentType = m3u8Response.headers.get("Content-Type");

  // if (!contentType || !contentType.startsWith('audio/mpegurl')) {
  //   return new Response("Invalid content type", { status: 500 });
  // }

  // Convert the response body to binary ArrayBuffer
  const m3u8Buffer = await m3u8Response.arrayBuffer();

  // Extract the URLs of the segments from the m3u8 buffer
  const m3u8Text = new TextDecoder().decode(m3u8Buffer);
  const lines = m3u8Text.split("\n");
  const segmentUrls = lines.filter((line) => line.startsWith("https://"));

  if (segmentUrls.length === 0) {
    return new Response("No segment URLs found in the m3u8 file", {
      status: 500,
    });
  }

  // Concatenate segment URLs to construct the MP3 file
  let mp3Buffer = new Uint8Array();
  for (const segmentUrl of segmentUrls) {
    const segmentResponse = await fetch(segmentUrl);

    if (!segmentResponse.ok) {
      return new Response("Error fetching segment: " + segmentUrl, {
        status: 500,
      });
    }

    const segmentBuffer = await segmentResponse.arrayBuffer();
    mp3Buffer = appendBuffer(mp3Buffer, segmentBuffer);
  }

  // Determine response type based on outputType parameter
  const headers = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
  };

  if (outputType === "stream") {
    // Stream the MP3 file
    return new Response(mp3Buffer, {
      status: 200,
      headers: {
        ...headers,
        "Content-Length": mp3Buffer.byteLength.toString(),
      },
    });
  } else {
    // Force download of the MP3 file
    return new Response(mp3Buffer, {
      status: 200,
      headers: {
        ...headers,
        "Content-Disposition": `attachment; filename="audio_nice.mp3"`,
        "Content-Length": mp3Buffer.byteLength.toString(),
      },
    });
  }
}

// Function to concatenate two ArrayBuffers
function appendBuffer(buffer1, buffer2) {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp;
}