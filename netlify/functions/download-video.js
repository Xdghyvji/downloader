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
    console.error('Error in function:', error.message);
    // Return a generic error to the user
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Failed to fetch video details.' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

/**
 * Handles YouTube URL processing
 * @param {string} url
 */
async function handleYouTube(url) {
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
    throw new Error('No downloadable formats found for this YouTube video.');
  }

  return {
    thumbnail: details.thumbnails[details.thumbnails.length - 1].url, // Get largest thumbnail
    title: details.title,
    author: details.author.name,
    links: links,
  };
}

/**
 * Handles Instagram URL processing (FRAGILE METHOD)
 * @param {string} url
 */
async function handleInstagram(url) {
  // This is a fragile scraping method. It works by fetching the public
  // HTML of the Reel and finding the "og:video" meta tag.
  // This will break the moment Instagram changes its HTML structure.
  
  try {
    const response = await fetch(url, {
      headers: {
        // Use a common user agent to look like a real browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch Instagram page. It may be private or unavailable.');
    }

    const html = await response.text();

    // Try to find the video URL
    const videoMatch = html.match(/<meta property="og:video" content="(.*?)"/i);
    const videoUrl = videoMatch ? videoMatch[1].replace(/&amp;/g, '&') : null;

    if (!videoUrl) {
      throw new Error('Could not find video URL. Instagram may have blocked the request or changed its layout.');
    }

    // Try to find the title (often just "Instagram post by...")
    const titleMatch = html.match(/<meta property="og:title" content="(.*?)"/i);
    const title = titleMatch ? titleMatch[1] : 'Instagram Reel';

    // Try to find the thumbnail
    const thumbMatch = html.match(/<meta property="og:image" content="(.*?)"/i);
    const thumbnail = thumbMatch ? thumbMatch[1].replace(/&amp;/g, '&') : 'https://placehold.co/160x160/ef4444/white?text=Reel';
    
    // Author is harder to get reliably, so we'll leave it generic
    const authorMatch = html.match(/"username":"(.*?)"/i);
    const author = authorMatch ? authorMatch[1] : 'Instagram User';

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
    throw new Error('Failed to scrape Instagram. This is very common. The Reel might be private or Instagram has temporarily blocked requests.');
  }
}
