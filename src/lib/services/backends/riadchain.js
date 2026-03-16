import { getPathInfo } from '@sveltia/utils/file';
import { get } from 'svelte/store';

import { createFileList } from '$lib/services/backends/process';
import { parseAssetFileInfo, updateStores } from '$lib/services/backends/git/shared/fetch';
import { prepareEntries } from '$lib/services/contents/file/process';
import { cmsConfig } from '$lib/services/config';
import { getGitHash, getBlob } from '$lib/services/utils/file';

/**
 * @import { BackendService, CommitResults, FileChange, RepositoryInfo, User } from '$lib/types/private';
 */

const backendName = 'riadchain';
const label = 'RiadChain Router';
const DEFAULT_ROUTER_URL = 'http://localhost:8080';
const ROUTER_URL_KEY = 'riadchain.router.url.v1';
const PRIVATE_KEY_KEY = 'riadchain.cms.privateKey';
const ASSET_INDEX_PATH = '/db/assets/index.json';
const PAGES_INDEX_PATH = '/db/pages/index.json';
const DEFAULT_PAGE_FILES = ['/db/pages/about.md'];
const SETTINGS_PATHS = [
  '/db/site.json',
  '/db/navigation.json',
  '/db/footer.json',
  '/db/social.json',
  '/db/seo.json',
  '/db/home.json',
  '/db/authors.json',
  '/db/post_defaults.json',
];
const THEME_CSS_PATH = '/db/theme/theme.css';
const THEME_TOKENS_PATH = '/db/theme/tokens.json';

const getRouterURL = () => {
  const config = get(cmsConfig);
  const fromConfig = config?.backend?.router_url;
  const fromStorage = localStorage.getItem(ROUTER_URL_KEY);
  return fromConfig || fromStorage || window.location.origin || DEFAULT_ROUTER_URL;
};

const getPrivateKey = () => localStorage.getItem(PRIVATE_KEY_KEY) || '';

const normalizePath = (path) => (path.startsWith('/') ? path : `/${path}`);

const inferContentType = (path, data) => {
  if (data instanceof File && data.type) {
    return data.type;
  }
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return 'application/javascript';
  return 'application/octet-stream';
};

const toBase64 = async (data) => {
  if (typeof data === 'string') {
    const bytes = new TextEncoder().encode(data);
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }
  const blob = getBlob(data);
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const parseFrontmatter = (content) => {
  if (!content.startsWith('---')) {
    return { meta: {}, body: content };
  }
  const parts = content.split('---');
  if (parts.length < 3) {
    return { meta: {}, body: content };
  }
  const raw = parts[1].trim();
  const body = parts.slice(2).join('---').trim();
  const meta = {};
  raw.split('\n').forEach((line) => {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) return;
    const value = rest.join(':').trim().replace(/^"|"$/g, '');
    if (key.trim() === 'tags') {
      return;
    }
    meta[key.trim()] = value;
  });
  if (raw.includes('tags')) {
    const tagLines = raw.split('\n').filter((l) => l.trim().startsWith('-'));
    meta.tags = tagLines.map((l) => l.replace('-', '').trim()).filter(Boolean);
  }
  return { meta, body };
};

const fetchJSON = async (path) => {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
};

const fetchText = async (path) => {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.text();
};

const buildFileList = async () => {
  const files = [];
  const indexPath = '/db/index.json';
  const indexData = await fetchJSON(indexPath);
  const indexText = JSON.stringify(indexData, null, 2);

  files.push({
    path: indexPath.replace(/^\//, ''),
    name: getPathInfo(indexPath).basename,
    size: indexText.length,
    sha: await getGitHash(indexText),
    text: indexText,
  });

  if (Array.isArray(indexData.posts)) {
    for (const post of indexData.posts) {
      if (!post.slug) continue;
      const postPath = `/db/content/${post.slug}.md`;
      const text = await fetchText(postPath);
      files.push({
        path: postPath.replace(/^\//, ''),
        name: getPathInfo(postPath).basename,
        size: text.length,
        sha: await getGitHash(text),
        text,
      });
    }
  }

  try {
    const pagesIndex = await fetchJSON(PAGES_INDEX_PATH);
    const pageEntries = Array.isArray(pagesIndex?.pages) ? pagesIndex.pages : [];
    for (const entry of pageEntries) {
      const slug = typeof entry === 'string' ? entry : entry?.slug;
      if (!slug) continue;
      const pagePath = `/db/pages/${slug}.md`;
      const text = await fetchText(pagePath);
      files.push({
        path: pagePath.replace(/^\//, ''),
        name: getPathInfo(pagePath).basename,
        size: text.length,
        sha: await getGitHash(text),
        text,
      });
    }
  } catch {
    for (const pagePath of DEFAULT_PAGE_FILES) {
      try {
        const text = await fetchText(pagePath);
        files.push({
          path: pagePath.replace(/^\//, ''),
          name: getPathInfo(pagePath).basename,
          size: text.length,
          sha: await getGitHash(text),
          text,
        });
      } catch {
        // Optional page file.
      }
    }
  }

  for (const configPath of SETTINGS_PATHS) {
    try {
      const configData = await fetchJSON(configPath);
      const configText = JSON.stringify(configData, null, 2);
      files.push({
        path: configPath.replace(/^\//, ''),
        name: getPathInfo(configPath).basename,
        size: configText.length,
        sha: await getGitHash(configText),
        text: configText,
      });
    } catch {
      // Optional config file.
    }
  }

  try {
    const themeText = await fetchText(THEME_CSS_PATH);
    files.push({
      path: THEME_CSS_PATH.replace(/^\//, ''),
      name: getPathInfo(THEME_CSS_PATH).basename,
      size: themeText.length,
      sha: await getGitHash(themeText),
      text: themeText,
    });
  } catch {
    // Theme CSS is optional.
  }

  try {
    const tokensData = await fetchJSON(THEME_TOKENS_PATH);
    const tokensText = JSON.stringify(tokensData, null, 2);
    files.push({
      path: THEME_TOKENS_PATH.replace(/^\//, ''),
      name: getPathInfo(THEME_TOKENS_PATH).basename,
      size: tokensText.length,
      sha: await getGitHash(tokensText),
      text: tokensText,
    });
  } catch {
    // Theme tokens are optional.
  }

  try {
    const assetIndex = await fetchJSON(ASSET_INDEX_PATH);
    const assetEntries = Array.isArray(assetIndex)
      ? assetIndex
      : Array.isArray(assetIndex.assets)
        ? assetIndex.assets
        : [];

    for (const entry of assetEntries) {
      const rawPath = typeof entry === 'string' ? entry : entry?.path;
      if (!rawPath) continue;
      const assetPath = normalizePath(rawPath);
      files.push({
        path: assetPath.replace(/^\//, ''),
        name: getPathInfo(assetPath).basename,
        size: typeof entry === 'object' ? entry.size : undefined,
        sha: typeof entry === 'object' ? entry.sha : undefined,
        meta: typeof entry === 'object' ? { content_type: entry.content_type } : undefined,
      });
    }
  } catch {
    // Asset index is optional.
  }

  const themePath = '/theme.css';
  try {
    const themeText = await fetchText(themePath);
    files.push({
      path: themePath.replace(/^\//, ''),
      name: getPathInfo(themePath).basename,
      size: themeText.length,
      sha: await getGitHash(themeText),
      text: themeText,
    });
  } catch {
    // Theme file is optional.
  }

  return files;
};

/**
 * Initialize the backend.
 * @returns {RepositoryInfo}
 */
const init = () => ({
  service: '',
  label,
  owner: '',
  repo: '',
  branch: 'main',
  databaseName: 'riadchain-cms',
});

/**
 * Sign in. No-op auth for router backend.
 * @returns {Promise<User>}
 */
const signIn = async () => ({ backendName });

/**
 * Sign out. No-op.
 */
const signOut = async () => {};

/**
 * Fetch entries and assets from the router.
 */
const fetchFiles = async () => {
  const files = await buildFileList();
  const { entryFiles, assetFiles, configFiles } = createFileList(files);
  const { entries, errors } = await prepareEntries(entryFiles);
  const assets = assetFiles.map((fileInfo) => parseAssetFileInfo(fileInfo));
  updateStores({ entries, assets, configFiles, errors });
};

/**
 * Save changes via the router upload endpoint.
 * @param {FileChange[]} changes
 * @returns {Promise<CommitResults>}
 */
const commitChanges = async (changes) => {
  const files = [];
  const indexChange = changes.find((c) => c.path === 'db/index.json' && c.data !== undefined);
  const postChanges = changes.filter((c) => c.path.startsWith('db/content/'));
  const assetChanges = changes.filter((c) => c.path.startsWith('db/assets/'));
  const pageIndexChange = changes.find((c) => c.path === 'db/pages/index.json' && c.data !== undefined);
  const pageChanges = changes.filter((c) => c.path.startsWith('db/pages/') && c.path.endsWith('.md'));

  for (const change of changes) {
    const { action, path, data } = change;
    if (action === 'delete' || data === undefined) {
      continue;
    }
    const content = await toBase64(data);
    files.push({
      path: normalizePath(path),
      content,
      content_type: inferContentType(path, data),
    });
  }

  if (!indexChange && postChanges.length) {
    const indexData = await fetchJSON('/db/index.json');
    const updatedPosts = (indexData.posts || []).filter((p) => {
      return !postChanges.some((c) => c.path.endsWith(`/${p.slug}.md`));
    });

    for (const change of postChanges) {
      if (change.action === 'delete' || change.data === undefined) {
        continue;
      }
      const slug = change.path.replace('db/content/', '').replace('.md', '');
      const content =
        typeof change.data === 'string' ? change.data : await getBlob(change.data).text();
      const { meta, body } = parseFrontmatter(content);
      const excerpt =
        meta.excerpt || body.split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 180);
      updatedPosts.unshift({
        slug,
        title: meta.title || slug,
        date: meta.date || '',
        excerpt,
        tags: meta.tags || [],
        read_time: meta.read_time || '',
      });
    }

    indexData.posts = updatedPosts;
    const indexText = JSON.stringify(indexData, null, 2);
    files.push({
      path: '/db/index.json',
      content: await toBase64(indexText),
      content_type: 'application/json',
    });
  }

  if (!pageIndexChange && pageChanges.length) {
    let pagesIndex = { pages: [] };
    try {
      const existing = await fetchJSON(PAGES_INDEX_PATH);
      pagesIndex = Array.isArray(existing?.pages) ? existing : { pages: [] };
    } catch {
      //
    }

    const updatedPages = Array.isArray(pagesIndex.pages) ? [...pagesIndex.pages] : [];
    const removePage = (slug) => {
      const idx = updatedPages.findIndex((p) => (typeof p === 'string' ? p : p?.slug) === slug);
      if (idx >= 0) updatedPages.splice(idx, 1);
    };
    const upsertPage = (page) => {
      const slug = page.slug;
      const idx = updatedPages.findIndex((p) => (typeof p === 'string' ? p : p?.slug) === slug);
      if (idx >= 0) {
        updatedPages[idx] = page;
      } else {
        updatedPages.push(page);
      }
    };

    for (const change of pageChanges) {
      const slug = change.path.replace('db/pages/', '').replace('.md', '');
      if (change.action === 'delete' || change.data === undefined) {
        removePage(slug);
        continue;
      }
      const content =
        typeof change.data === 'string' ? change.data : await getBlob(change.data).text();
      const { meta } = parseFrontmatter(content);
      upsertPage({
        slug,
        title: meta.title || slug,
      });
    }

    pagesIndex.pages = updatedPages;
    const pagesText = JSON.stringify(pagesIndex, null, 2);
    files.push({
      path: PAGES_INDEX_PATH,
      content: await toBase64(pagesText),
      content_type: 'application/json',
    });
  }

  if (assetChanges.length) {
    let assetIndex = { assets: [] };
    try {
      const existing = await fetchJSON(ASSET_INDEX_PATH);
      if (Array.isArray(existing)) {
        assetIndex = { assets: existing };
      } else if (Array.isArray(existing.assets)) {
        assetIndex = { assets: existing.assets };
      }
    } catch {
      //
    }

    const assetMap = new Map();
    assetIndex.assets.forEach((entry) => {
      const assetPath = typeof entry === 'string' ? entry : entry?.path;
      if (!assetPath) return;
      assetMap.set(assetPath, typeof entry === 'string' ? { path: assetPath } : entry);
    });

    for (const change of assetChanges) {
      const assetPath = normalizePath(change.path).replace(/^\//, '');
      if (change.action === 'delete' || change.data === undefined) {
        assetMap.delete(assetPath);
        continue;
      }

      const blob = getBlob(change.data);
      const size = blob.size ?? (typeof change.data === 'string' ? change.data.length : undefined);
      const sha = await getGitHash(blob);
      assetMap.set(assetPath, {
        path: assetPath,
        size,
        sha,
        content_type: inferContentType(change.path, change.data),
      });
    }

    const assetIndexText = JSON.stringify({ assets: Array.from(assetMap.values()) }, null, 2);
    files.push({
      path: ASSET_INDEX_PATH,
      content: await toBase64(assetIndexText),
      content_type: 'application/json',
    });
  }

  if (files.length) {
    const response = await fetch(getRouterURL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: getPrivateKey(),
        action: 'upload_content',
        data: {
          manifest: { version: '1.0' },
          files,
          nonce: Date.now(),
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload changes');
    }
  }

  const results = await Promise.all(
    changes
      .filter((change) => change.data !== undefined)
      .map(async (change) => {
        const data = change.data;
        const file = getBlob(data);
        return [change.path, { file, sha: await getGitHash(file) }];
      }),
  );

  return {
    sha: await getGitHash(new Date().toISOString()),
    files: Object.fromEntries(results),
  };
};

/**
 * Fetch asset blobs from the router.
 * @param {import('$lib/types/private').Asset} asset
 * @returns {Promise<Blob>}
 */
const fetchBlob = async (asset) => {
  const path = normalizePath(asset.path);
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${asset.path}`);
  }
  return response.blob();
};

/**
 * @type {BackendService}
 */
export default {
  isGit: false,
  name: backendName,
  label,
  init,
  signIn,
  signOut,
  fetchFiles,
  commitChanges,
  fetchBlob,
};
