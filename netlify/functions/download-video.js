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
  // We only accept POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  try {
    // Parse the incoming body
    const { url, service } = JSON.parse(event.body);

    if (!url || !service) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing "url" or "service" in request body' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    let data;
    if (service === 'youtube') {
      data = await handleYouTube(url);
    } else if (service === 'instagram') {
      data = await handleInstagram(url);
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid service specified' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

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

  const response = await fetch(`${YOUTUBE_API_URL}?videoId=${videoId}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPID_API_KEY,
      'x-rapidapi-host': YOUTUBE_API_HOST
    }
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({})); // Get error details if possible
    throw new Error(`YouTube API failed: ${errData.message || response.statusText}`);
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
  const response = await fetch(`${INSTAGRAM_API_URL}?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPID_API_KEY,
      'x-rapidapi-host': INSTAGRAM_API_HOST
    }
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({})); // Get error details if possible
    throw new Error(`Instagram API failed: ${errData.message || response.statusText}`);
  }

  const data = await response.json();

  // The API doc suggests the video is in "media"
  if (!data.media) {
    throw new Error('Instagram API did not return a media URL.');
  }

  // Map API response to our frontend's expected format
  return {
    thumbnail: data.thumbnail || 'https.placehold.co/160x160/ef4444/white?text=Reel',
    title: data.title || 'Instagram Reel',
    author: data.author || 'Instagram User',
    links: [
      { quality: 'HD Video', url: data.media }
    ],
  };
}

