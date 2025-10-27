// --- Netlify Function: netlify/functions/download-video.js ---

// This file is now refactored to use RapidAPI instead of direct scraping.

// --- CONFIGURATION ---
// Your RapidAPI Key from your prompt
const RAPID_API_KEY = '2fafe87e1cmshb321fc5c96008fep18805djsn0b6103721680';
// NOTE: For true production, move this to Netlify Environment Variables.

// YouTube API details
const YOUTUBE_API_HOST = 'youtube-media-downloader.p.rapidapi.com';
const YOUTUBE_API_URL = 'https://youtube-media-downloader.p.rapidapi.com/v2/video/details'; // Using the "Get Video Details" endpoint

// Instagram API details
const INSTAGRAM_API_HOST = 'instagram-reels-downloader-api.p.rapidapi.com';
const INSTAGRAM_API_URL = 'https://instagram-reels-downloader-api.p.rapidapi.com/download';

/**
 * Main handler function for the Netlify serverless function.
 */
exports.handler = async (event) => {
  console.log('Function handler started.'); // Added log

  // We only accept POST requests
  if (event.httpMethod !== 'POST') {
    console.log('Rejected non-POST request.'); // Added log
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  try {
    // Parse the incoming body
    console.log('Parsing body...'); // Added log
    const { url, service } = JSON.parse(event.body);
    console.log(`Received: ${service} - ${url}`); // Added log

    if (!url || !service) {
      console.log('Missing URL or service.'); // Added log
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing "url" or "service" in request body' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    let data;
    if (service === 'youtube') {
      console.log('Calling handleYouTube...'); // Added log
      data = await handleYouTube(url);
    } else if (service === 'instagram') {
      console.log('Calling handleInstagram...'); // Added log
      data = await handleInstagram(url);
    } else {
      console.log(`Invalid service: ${service}`); // Added log
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid service specified' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    console.log('Successfully fetched data. Returning 200.'); // Added log
    // Success
    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    };

  } catch (error) {
    console.error('Error in function:', error); // Log the full error
    
    // Provide a generic error message, now driven by the API failures
    let errorMessage = 'Failed to fetch video details.';
    if (error.message) {
        errorMessage = error.message;
    }

    // Return a structured error to the user
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMessage }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

/**
 * Helper function to extract YouTube video ID from various URL formats
 * @param {string} url
 */
function extractYouTubeId(url) {
    let videoId = null;
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') {
            videoId = urlObj.pathname.slice(1);
        } else if (urlObj.hostname.includes('youtube.com')) {
            videoId = urlObj.searchParams.get('v');
        }
    } catch (e) {
        console.error('Invalid URL for YouTube ID extraction', e);
        return null;
    }
    return videoId;
}

/**
 * Handles YouTube URL processing using RapidAPI
 * @param {string} url
 */
async function handleYouTube(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new Error('Invalid or unsupported YouTube URL.');
  }

  console.log(`Fetching YouTube video with ID: ${videoId}`); // Added log
  const response = await fetch(`${YOUTUBE_API_URL}?videoId=${videoId}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPID_API_KEY,
      'x-rapidapi-host': YOUTUBE_API_HOST
    }
  });

  if (!response.ok) {
    // --- EDITED BLOCK ---
    // Try to parse the error as JSON, but if it fails, get it as text.
    // This handles cases where RapidAPI sends a plain text error (e.g., "Invalid API Key")
    let errorBody = `YouTube API failed with status: ${response.statusText}`;
    try {
        const errData = await response.json();
        errorBody = errData.message || JSON.stringify(errData);
    } catch (e) {
        // Not JSON, try to get text
        try {
            const errText = await response.text();
            errorBody = errText || errorBody;
        } catch (textError) {
            // Failed to get text, just use status
        }
    }
    console.error('YouTube API Error:', errorBody); // Added log
    throw new Error(errorBody);
    // --- END EDITED BLOCK ---
  }

  const data = await response.json();

  if (!data.formats || data.formats.length === 0) {
    throw new Error('This video has no downloadable formats from the API.');
  }

  // Map API response to our frontend's expected format
  const links = [];
  
  // Try to find a good video+audio format
  const videoFormat = data.formats.find(f => f.mimeType?.includes('video/mp4') && f.height && f.audioBitrate);
  if (videoFormat) {
    links.push({
      quality: `${videoFormat.height}p (Video)`,
      url: videoFormat.url,
    });
  }

  // Try to find a good audio-only format
  const audioFormat = data.formats.find(f => f.mimeType?.includes('audio/mp4') && !f.height && f.audioBitrate);
  if (audioFormat) {
    links.push({
      quality: `MP3 (Audio)`,
      url: audioFormat.url,
    });
  }
  
  // Fallback if no specific formats found
  if (links.length === 0 && data.formats[0].url) {
      links.push({
          quality: data.formats[0].qualityLabel || 'Default',
          url: data.formats[0].url
      });
  }

  return {
    thumbnail: data.thumbnails[data.thumbnails.length - 1].url, // Get largest thumbnail
    title: data.title,
    author: data.channelName,
    links: links,
  };
}


/**
 * Handles Instagram URL processing using RapidAPI
 * @param {string} url
 */
async function handleInstagram(url) {
  console.log(`Fetching Instagram reel: ${url}`); // Added log
  const response = await fetch(`${INSTAGRAM_API_URL}?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPID_API_KEY,
      'x-rapidapi-host': INSTAGRAM_API_HOST
    }
  });

  if (!response.ok) {
    // --- EDITED BLOCK ---
    // Try to parse the error as JSON, but if it fails, get it as text.
    let errorBody = `Instagram API failed with status: ${response.statusText}`;
    try {
        const errData = await response.json();
        // Use the 'messages' field from the 504 error example
        errorBody = errData.message || errData.messages || JSON.stringify(errData);
    } catch (e) {
        // Not JSON, try to get text
        try {
            const errText = await response.text();
            errorBody = errText || errorBody;
        } catch (textError) {
            // Failed to get text, just use status
        }
    }
    console.error('Instagram API Error:', errorBody); // Added log
    throw new Error(errorBody);
    // --- END EDITED BLOCK ---
  }

  const data = await response.json();

  // --- **** EDITED BLOCK **** ---
  // Parse the JSON structure YOU provided
  
  // Check for the nested data structure
  if (!data.data || !data.data.medias || data.data.medias.length === 0) {
    // Check for a top-level error message from the API
    if (data.message && data.success === false) {
        throw new Error(`Instagram API Error: ${data.message}`);
    }
    throw new Error('Instagram API did not return valid media data.');
  }
  
  // Find the first media item that is a video
  const videoMedia = data.data.medias.find(m => m.type === 'video');
  
  if (!videoMedia || !videoMedia.url) {
      throw new Error('Instagram API response did not contain a video URL.');
  }
  
  // Map API response to our frontend's expected format
  return {
    thumbnail: data.data.thumbnail || 'https://placehold.co/160x160/ef4444/white?text=Reel',
    title: data.data.title || 'Instagram Reel',
    author: data.data.author || 'Instagram User',
    links: [
      { quality: 'HD Video', url: videoMedia.url }
    ],
  };
  // --- **** END EDITED BLOCK **** ---
}

