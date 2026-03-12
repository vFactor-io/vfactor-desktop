export interface GifCoverResult {
  id: string
  title: string
  previewUrl: string
  stillUrl: string
  coverUrl: string
  sourceUrl: string
}

interface GiphyImageVariant {
  url?: string
  webp?: string
}

interface GiphyGifPayload {
  id: string
  title?: string
  url?: string
  images?: {
    original?: GiphyImageVariant
    fixed_height?: GiphyImageVariant
    fixed_width?: GiphyImageVariant
    fixed_height_still?: GiphyImageVariant
    fixed_width_still?: GiphyImageVariant
    downsized_medium?: GiphyImageVariant
    preview_gif?: GiphyImageVariant
  }
}

interface GiphyResponse {
  data: GiphyGifPayload[]
  meta?: {
    msg?: string
  }
}

const GIPHY_API_BASE_URL = "https://api.giphy.com/v1/gifs"
const DEFAULT_LIMIT = 18

function getConfiguredApiKey() {
  const apiKey = import.meta.env.VITE_GIPHY_API_KEY?.trim()
  return apiKey || null
}

function mapGifResult(gif: GiphyGifPayload): GifCoverResult | null {
  const previewUrl =
    gif.images?.fixed_height?.webp ||
    gif.images?.fixed_height?.url ||
    gif.images?.fixed_width?.webp ||
    gif.images?.fixed_width?.url ||
    gif.images?.preview_gif?.url
  const stillUrl =
    gif.images?.fixed_width_still?.url ||
    gif.images?.fixed_height_still?.url ||
    previewUrl
  const coverUrl =
    gif.images?.original?.url ||
    gif.images?.downsized_medium?.url ||
    gif.images?.fixed_width?.url ||
    gif.images?.fixed_height?.url

  if (!previewUrl || !stillUrl || !coverUrl) {
    return null
  }

  return {
    id: gif.id,
    title: gif.title?.trim() || "GIF cover",
    previewUrl,
    stillUrl,
    coverUrl,
    sourceUrl: gif.url || "https://giphy.com/",
  }
}

async function requestGifs(
  endpoint: "search" | "trending",
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<GifCoverResult[]> {
  const apiKey = getConfiguredApiKey()

  if (!apiKey) {
    return []
  }

  const url = new URL(`${GIPHY_API_BASE_URL}/${endpoint}`)
  url.searchParams.set("api_key", apiKey)
  url.searchParams.set("limit", String(DEFAULT_LIMIT))
  url.searchParams.set("rating", "g")
  url.searchParams.set("bundle", "messaging_non_clips")

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`GIPHY request failed with ${response.status}`)
  }

  const payload = (await response.json()) as GiphyResponse

  if (!payload.data) {
    throw new Error(payload.meta?.msg || "Invalid GIPHY response")
  }

  return payload.data.map(mapGifResult).filter((gif): gif is GifCoverResult => gif !== null)
}

export function isGifSearchConfigured() {
  return Boolean(getConfiguredApiKey())
}

export async function searchGifCovers(query: string, signal?: AbortSignal) {
  return requestGifs("search", { q: query, lang: "en" }, signal)
}

export async function fetchTrendingGifCovers(signal?: AbortSignal) {
  return requestGifs("trending", {}, signal)
}
