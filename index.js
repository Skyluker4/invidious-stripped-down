import Koa from 'koa';
import { Innertube } from 'youtubei.js';
import Keyv from 'keyv';
const app = new Koa();
import Router from '@koa/router';
import dns from 'dns';
import QuickLRU from 'quick-lru';
import { request } from 'undici';

dns.setDefaultResultOrder(process.env.DNS_ORDER || 'verbatim');

const router = new Router();
const youtube = await Innertube.create();

const hostname = process.env.HOST_PROXY;

const timeExpireCache = 1000 * 60 * 60 * 1;
const lru = new QuickLRU({ maxSize: process.env.KEYV_MAX_SIZE || 5000, maxAge: timeExpireCache });
const keyv = new Keyv(process.env.KEYV_ADDRESS || undefined, { store: lru });

async function getBasicVideoInfoDash(videoId) {
  const keyvKey = videoId + "-dash";
  let basicVideoInfo = await keyv.get(keyvKey);

  if (basicVideoInfo)
    return basicVideoInfo;

  try {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'ANDROID');
  } catch (error) {
    await keyv.set(keyvKey, {
      playability_status: {
        status: "Not OK",
        reason: "Video unavailable: " + videoId
      }
    }, timeExpireCache);
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'WEB');
  }

  if (basicVideoInfo.playability_status.reason) {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'TV_EMBEDDED');
  }

  if (basicVideoInfo.streaming_data) {
    basicVideoInfo.streaming_data.adaptive_formats = basicVideoInfo.streaming_data.adaptive_formats
      .filter(i => i.mime_type.includes("audio/mp4" | "video/mp4"));

    basicVideoInfo.streaming_data.dashFile = await basicVideoInfo.toDash((url) => {
      url.host = hostname;
      return url;
    });
  }

  await keyv.set(keyvKey, (({ streaming_data, playability_status }) => ({ streaming_data, playability_status }))(basicVideoInfo), timeExpireCache);

  return basicVideoInfo;
}

async function getBasicVideoInfoLatestVersion(videoId) {
  const keyvKey = videoId + "-latest";
  let basicVideoInfo = await keyv.get(keyvKey);

  if (basicVideoInfo)
    return basicVideoInfo;

  try {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'ANDROID');
  } catch (error) {
    await keyv.set(keyvKey, {
      playability_status: {
        status: "Not OK",
        reason: "Video unavailable: " + videoId
      }
    }, timeExpireCache);
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'WEB');
  }

  if (basicVideoInfo.playability_status.reason) {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'TV_EMBEDDED');
  }

  if (basicVideoInfo.streaming_data) {
    let formats = [];
    for (let format of basicVideoInfo.streaming_data.formats) {
      if (format.signature_cipher)
        format.url = format.decipher(youtube.session.player)
      formats.push(format);
    }
    basicVideoInfo.streaming_data.formats = formats;
  }

  await keyv.set(keyvKey, (({ streaming_data, playability_status }) => ({ streaming_data, playability_status }))(basicVideoInfo), timeExpireCache);

  return basicVideoInfo;
}

router.get('/api/manifest/dash/id/:videoId', async (ctx) => {
  const videoId = ctx.params.videoId;
  ctx.set("access-control-allow-origin", "*");

  try {
    const basicVideoInfo = await getBasicVideoInfoDash(videoId);
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw (new Error("The video can't be played: " + videoId + " due to reason: " + basicVideoInfo.playability_status.reason))
    }
    ctx.set("content-type", "application/dash+xml");
    ctx.body = basicVideoInfo.streaming_data.dashFile;
  } catch (error) {
    ctx.status = 400;
    return ctx.body = error;
  }
});

router.get('/api/manifest/hls_variant/(.*)', async (ctx) => {
  ctx.set("access-control-allow-origin", "*");
  ctx.set("content-type", "application/x-mpegURL");

  const parseVideoId = ctx.request.url.split('/id/').pop().split('/')[0];
  let videoId = "";

  if (parseVideoId) {
    videoId = parseVideoId.match(/\w+/m)[0];
  }
  else if (parseVideoId == null && ctx.request.query.id) {
    videoId = ctx.request.query.id;
  }
  else {
    ctx.body = "Video ID not found.";
    ctx.status = 400;
    return;
  }

  try {
    const basicVideoInfo = await getBasicVideoInfoLatestVersion(videoId);
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw (new Error("The video can't be played: " + videoId + " due to reason: " + basicVideoInfo.playability_status.reason))
    }

    const hlsManifestUrl = basicVideoInfo.streaming_data.hls_manifest_url;

    const {
      statusCode,
      body
    } = await request('https://www.youtube.com' + (new URL(hlsManifestUrl)).pathname);

    let bodyText = await body.text();

    if (statusCode == 200) {
      ctx.body = bodyText.replaceAll("www.youtube.com", hostname);
      ctx.status = 200;
    }
    else {
      ctx.body = body;
      ctx.status = statusCode;
    }

  } catch (error) {
    ctx.status = 400;
    return ctx.body = error;
  }
});

router.get('/api/manifest/hls_playlist/(.*)', async (ctx, next) => {
  ctx.set("access-control-allow-origin", "*");
  ctx.set("content-type", "application/x-mpegURL");

  const finalUrl = ctx.request.url.split("?")[0];

  const {
    statusCode,
    body
  } = await request('https://www.youtube.com' + finalUrl);

  let bodyText = await body.text();

  if (statusCode == 200) {
    ctx.body = bodyText.replaceAll("youtube.com", hostname);
    ctx.status = 200;
  }
  else {
    ctx.body = body;
    ctx.status = statusCode;
  }
});

router.get('/latest_version', async (ctx) => {
  const videoId = ctx.query.id;
  const itagId = ctx.query.itag;
  ctx.set("access-control-allow-origin", "*");

  if (!videoId || !itagId) {
    return ctx.body = "Please specify the itag and video ID";
  }

  try {
    const basicVideoInfo = await getBasicVideoInfoLatestVersion(videoId);
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw (new Error("The video can't be played: " + videoId + " due to reason: " + basicVideoInfo.playability_status.reason));
    }
    const streamingData = basicVideoInfo.streaming_data;
    const availableFormats = streamingData.formats.concat(streamingData.adaptive_formats);
    const selectedItagFormat = availableFormats.filter(i => i.itag == itagId);
    if (selectedItagFormat.length === 0) {
      ctx.status = 400;
      return ctx.body = "No itag found.";
    }
    if (!selectedItagFormat[0].url) {
      throw (new Error("No URL, the video can't be played: " + videoId));
    }
    let urlToRedirect = new URL(selectedItagFormat[0].url);
    urlToRedirect.host = hostname;
    ctx.redirect(urlToRedirect)
  } catch (error) {
    console.log(error)
    ctx.status = 400;
    return ctx.body = error;
  }
});

app
  .use(router.routes())
  .use(router.allowedMethods());

let bindAddress = process.env.BIND_ADDRESS || "0.0.0.0";
let bindPort = process.env.BIND_PORT || "3000";

const server = app.listen(bindPort, bindAddress, () => {
  console.log(`Started proxy server on ${bindAddress}:${bindPort}`);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  server.close(err => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
});
