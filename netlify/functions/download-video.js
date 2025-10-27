// --- Netlify Function: netlify/functions/download-video.js ---

// Import the YouTube downloader library
const ytdl = require('ytdl-core');

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
    
    let errorMessage = 'Failed to fetch video details.';
    
    // Check if this is a ytdl-core error with a status code
    if (error.statusCode === 410) {
        errorMessage = 'YouTube is actively blocking this server request (Error 410). This may be due to video restrictions or anti-scraping measures. Please try a different video or try again later.';
    } else if (error.message) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
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
 * Handles YouTube URL processing
 * @param {string} url
 */
async function handleYouTube(url) {
  try {
    if (!ytdl.validateID(url) && !ytdl.validateURL(url)) {
      throw new Error('Invalid YouTube URL.');
    }

    const info = await ytdl.getInfo(url);
    const details = info.videoDetails;

    // Find the highest quality video format that has both video and audio
    const videoFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highestvideo',
      filter: 'videoandaudio',
    });

    // Find the highest quality audio-only format
    const audioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    const links = [];
    if (videoFormat) {
      links.push({
        quality: `${videoFormat.height}p (Video)`,
        url: videoFormat.url,
      });
    }
    if (audioFormat) {
      links.push({
        quality: `MP3 (${audioFormat.audioBitrate}kbps)`,
        url: audioFormat.url,
      });
    }

    if (links.length === 0) {
      // This can happen with live streams or unreleased premieres
      throw new Error('No downloadable formats found. This may be a live stream or a premiere.');
    }

    return {
      thumbnail: details.thumbnails[details.thumbnails.length - 1].url, // Get largest thumbnail
      title: details.title,
      author: details.author.name,
      links: links,
    };
  } catch (err) {
    console.error('YouTube handle error:', err);
    // Forward the specific error (like the 410) to the main handler
    throw err; 
  }
}


/**
 * Handles Instagram URL processing (NEW ATTEMPT)
 * @param {string} url
 */
async function handleInstagram(url) {
  // This is a new, fragile scraping method. It tries to get a JSON
  // object from Instagram by appending `?__a=1&__d=dis`.
  // This will also break the moment Instagram changes its API.

  // Clean the URL and add the query parameters
  const cleanUrl = new URL(url);
  cleanUrl.searchParams.set('__a', '1');
  cleanUrl.searchParams.set('__d', 'dis');
  
  const apiUrl = cleanUrl.href;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        // Use a common user agent to look like a real browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        // This cookie can sometimes help
        'Cookie': 'ig_did=111-111-111-111; ig_nrcb=1'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Instagram API (Status: ${response.status}). The API may be blocked or the link is invalid.`);
    }

    const data = await response.json();
    
    // Navigate the complex JSON structure.
    // This is the part that breaks most often.
    const postData = data.graphql?.shortcode_media;

    if (!postData) {
      // Fallback for a different possible JSON structure
      const items = data.items;
      if (items && items[0]) {
        return extractFromItems(items[0]);
      }
      throw new Error('Could not find "shortcode_media" or "items" in Instagram JSON response. API structure has likely changed.');
    }

    const videoUrl = postData.video_url;
    if (!videoUrl) {
      throw new Error('Video URL not found in JSON data. This may not be a video post.');
    }

    return {
      thumbnail: postData.display_url,
      title: postData.edge_media_to_caption?.edges[0]?.node?.text || 'Instagram Reel',
      author: postData.owner?.username || 'Instagram User',
      links: [
        { quality: 'HD Video', url: videoUrl }
      ],
    };

  } catch (err) {
    console.error('Instagram scrape error:', err.message);
    // Give a specific error if it's a JSON parse error, which happens when IG returns HTML/login page
    if (err.name === 'FetchError' && err.type === 'invalid-json') {
      throw new Error('Failed to parse Instagram response. Instagram is likely redirecting to a login page, blocking the request.');
    }
    throw new Error(`Failed to scrape Instagram. This is very common. The Reel might be private or Instagram has temporarily blocked requests. (${err.message})`);
  }
}

/**
 * Helper function to extract data from the "items" array structure
 * @param {object} item
 */
function extractFromItems(item) {
    let videoUrl = null;
    if (item.video_versions && item.video_versions.length > 0) {
        videoUrl = item.video_versions[0].url;
    }

    if (!videoUrl) {
        throw new Error('Video URL not found in "items" data. This may not be a video post.');
    }
    
    const thumbnail = item.image_versions2?.candidates[0]?.url || 'https.placehold.co/160x160/ef4444/white?text=Reel';
    const title = item.caption?.text || 'Instagram Reel';
    const author = item.user?.username || 'Instagram User';

    return {
      thumbnail: thumbnail,
      title: title,
      author: author,
      links: [
        { quality: 'HD Video', url: videoUrl }
      ],
    };
}

