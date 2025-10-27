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
 * Handles Instagram URL processing (FINAL ATTEMPT: Aggressive HTML Scraper)
 * @param {string} url
 */
async function handleInstagram(url) {
  // This is our final attempt. It fetches the public HTML of the Reel
  // and tries multiple patterns to find the video data.
  
  // Clean URL to remove any tracking params
  const cleanUrl = new URL(url);
  cleanUrl.search = ''; // Remove all query parameters
  const finalUrl = cleanUrl.href;

  try {
    const response = await fetch(finalUrl, {
      headers: {
        // Use a common user agent to look like a real browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Instagram page (Status: ${response.status}). It may be private, deleted, or Instagram is blocking us.`);
    }

    const html = await response.text();

    // --- Pattern 1: Try to find the "og:video" meta tag ---
    let videoUrl = html.match(/<meta property="og:video" content="(.*?)"/i)?.[1]?.replace(/&amp;/g, '&');
    
    // --- Pattern 2: If "og:video" fails, parse script tags for JSON data ---
    if (!videoUrl) {
      try {
        // This regex looks for a <script> tag containing `video_url`
        const scriptJsonMatch = html.match(/<script type="application\/json".*?>(.*?)<\/script>/);
        if (scriptJsonMatch && scriptJsonMatch[1]) {
          const jsonData = JSON.parse(scriptJsonMatch[1]);
          // This JSON structure is a nightmare and changes often.
          // We are guessing the path to the video data.
          videoUrl = jsonData.props?.pageProps?.media?.video_url || 
                     jsonData.props?.pageProps?.post?.video_url ||
                     jsonData.graphql?.shortcode_media?.video_url;
        }
      } catch (e) {
        // JSON parsing failed or `video_url` not found, continue to next pattern
        console.warn('Instagram Pattern 2 failed:', e.message);
      }
    }
    
    // --- Pattern 3: If JSON parsing fails, try a desperate regex for any "video_url" ---
     if (!videoUrl) {
        // This is a last-ditch effort to find a video_url anywhere in the HTML
        videoUrl = html.match(/"video_url":"(.*?)"/i)?.[1]?.replace(/\\u0026/g, '&');
     }


    // --- Final Check ---
    if (!videoUrl) {
      throw new Error('Could not find video URL using any method. Instagram has changed its layout or is blocking the request.');
    }

    // --- Get Other Details (Best Effort) ---
    const title = html.match(/<meta property="og:title" content="(.*?)"/i)?.[1] || 'Instagram Reel';
    const thumbnail = html.match(/<meta property="og:image" content="(.*?)"/i)?.[1]?.replace(/&amp;/g, '&') || 'https.placehold.co/160x160/ef4444/white?text=Reel';
    const author = html.match(/"username":"(.*?)"/i)?.[1] || 'Instagram User';

    return {
      thumbnail: thumbnail,
      title: title,
      author: author,
      links: [
        { quality: 'HD Video', url: videoUrl }
      ],
    };

  } catch (err) {
    console.error('Instagram scrape error:', err.message);
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

