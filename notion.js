// notion.js

const NOTION_API_VERSION = "2022-06-28";

// Fetches data from Notion API with standard headers
export async function fetchWithAuth(url, method, token, body = null) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_API_VERSION,
    'Content-Type': 'application/json'
  };
  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Notion API Error: ${errText}`);
  }
  return await response.json();
}

/**
 * Validates token and returns recent pages where the integration has access.
 */
export async function getPages(token) {
  const data = await fetchWithAuth('https://api.notion.com/v1/search', 'POST', token, {
    filter: { value: 'page', property: 'object' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  });
  
  return data.results.map(page => {
    let title = 'Untitled Page';
    try {
      if (page.properties?.title?.title?.length > 0) {
        title = page.properties.title.title[0].plain_text;
      } else if (page.properties?.Name?.title?.length > 0) {
        title = page.properties.Name.title[0].plain_text;
      } else if (page.properties?.title?.rich_text?.length > 0) {
        title = page.properties.title.rich_text[0].plain_text;
      }
    } catch (e) {
      console.warn("Could not extract page title", e);
    }
    return { id: page.id, title };
  });
}

/**
 * Uploads a base64 Data URL to a proxy host to get a public URL for Notion.
 * NOTE: Notion API strictly requires external URLs for image blocks and does not accept Base64 natively.
 */
async function uploadToImageProxy(base64Data) {
  const b64 = base64Data.split(',')[1];
  const formData = new FormData();
  formData.append('key', '6d207e02198a847aa98d0a2a901485a5'); // Standard public API key
  formData.append('action', 'upload');
  formData.append('source', b64);
  formData.append('format', 'json');
  
  try {
    const res = await fetch('https://freeimage.host/api/1/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error('Host provider rejected upload: ' + errTxt);
    }
    
    const json = await res.json();
    if (json.status_code !== 200) {
      throw new Error(json.error?.message || 'Provider failure.');
    }
    return json.image.url;
  } catch (err) {
    throw new Error('Image Proxy Network Error: ' + err.message);
  }
}

/**
 * Appends the screenshot data to the designated Notion page.
 */
export async function appendScreenshot(token, pageId, videoTitle, timestamp, base64Image, caption, isNewVideo) {
  const imageUrl = await uploadToImageProxy(base64Image);
  const children = [];
  
  // 1. Add Header if it's the first screenshot of the video
  if (isNewVideo) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: videoTitle } }]
      }
    });
  }

  // 2. Add Image Block
  const imageBlock = {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url: imageUrl }
    }
  };
  
  // Add Caption to Image if provided or fallback to timestamp
  let captionText = `[${timestamp}]`;
  if (caption && caption.trim().length > 0) {
    captionText += ` - ${caption}`;
  }
  imageBlock.image.caption = [{ type: 'text', text: { content: captionText } }];
  
  children.push(imageBlock);
  
  // 3. Patch to Notion Page
  return await fetchWithAuth(`https://api.notion.com/v1/blocks/${pageId}/children`, 'PATCH', token, {
    children
  });
}
