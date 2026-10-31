import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import {
  Image as ImageIcon,
  Film,
  Upload,
  Download,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react';

export type StudioMode = 'image' | 'video';

interface MediaStudioPanelProps {
  activeTopic: string;
  requestedMode?: { mode: StudioMode; seq: number } | null;
}

function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Invalid file encoding'));
        return;
      }
      resolve({
        base64: dataUrl.slice(commaIdx + 1),
        mimeType: file.type || 'image/png',
        previewUrl: dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('Could not read uploaded file'));
    reader.readAsDataURL(file);
  });
}

export default function MediaStudioPanel({ activeTopic, requestedMode }: MediaStudioPanelProps) {
  const [studioMode, setStudioMode] = useState<StudioMode>('image');

  useEffect(() => {
    if (requestedMode) {
      setStudioMode(requestedMode.mode);
    }
  }, [requestedMode]);

  // -------------------------------------------------------------------------
  // Image Studio State (`gemini-nano-banana-2.1`)
  // -------------------------------------------------------------------------
  const [imgPrompt, setImgPrompt] = useState<string>(
    `Clean scientific editorial visualization illustrating ${activeTopic}, dark obsidian studio background, crisp optical lighting, high detail`
  );
  const [imgAspectRatio, setImgAspectRatio] = useState<string>('16:9');
  const [imgSize, setImgSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [refImage, setRefImage] = useState<{
    base64: string;
    mimeType: string;
    previewUrl: string;
    name: string;
  } | null>(null);
  const [imgLoading, setImgLoading] = useState<boolean>(false);
  const [imgError, setImgError] = useState<string>('');
  const [generatedImage, setGeneratedImage] = useState<{
    dataUrl: string;
    caption: string;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Video & Photo Animation State (`gemini-omni-1.1-flash` Interactions API)
  // -------------------------------------------------------------------------
  const [videoPrompt, setVideoPrompt] = useState<string>(
    `Slow cinematic orbital camera glide across a luminous scientific visualization of ${activeTopic}, subtle volumetric particle motion, crisp deep-space lighting`
  );
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [videoSourcePhoto, setVideoSourcePhoto] = useState<{
    base64: string;
    mimeType: string;
    previewUrl: string;
    name: string;
  } | null>(null);
  const [videoLoading, setVideoLoading] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<string>('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string>('');

  const handleImageUpload = async (
    e: ChangeEvent<HTMLInputElement>,
    target: 'image-edit' | 'photo-to-video'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      if (target === 'image-edit') setImgError('Please choose an image smaller than 12 MB.');
      else setVideoError('Please choose a photo smaller than 12 MB.');
      return;
    }
    try {
      const encoded = await readFileAsBase64(file);
      if (target === 'image-edit') {
        setRefImage({ ...encoded, name: file.name });
        setImgError('');
      } else {
        setVideoSourcePhoto({ ...encoded, name: file.name });
        setVideoError('');
      }
    } catch {
      if (target === 'image-edit') setImgError('Could not read reference image.');
      else setVideoError('Could not read uploaded photo.');
    }
  };

  const handleGenerateOrEditImage = async (e: FormEvent) => {
    e.preventDefault();
    if (!imgPrompt.trim() || imgLoading) return;

    setImgLoading(true);
    setImgError('');
    try {
      const res = await fetch('/api/media/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imgPrompt.trim(),
          aspectRatio: imgAspectRatio,
          imageSize: imgSize,
          ...(refImage
            ? {
                imageBase64: refImage.base64,
                mimeType: refImage.mimeType,
              }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        imageDataUrl?: string;
        caption?: string;
        detail?: string;
      };
      if (!res.ok || !data.imageDataUrl) {
        setImgError(data.detail || `Image synthesis failed (${res.status}).`);
        return;
      }
      setGeneratedImage({
        dataUrl: data.imageDataUrl,
        caption: data.caption || '',
      });
    } catch {
      setImgError('Network error while contacting the Nano Banana 2.1 image studio.');
    } finally {
      setImgLoading(false);
    }
  };

  const handleGenerateVideo = async (e: FormEvent) => {
    e.preventDefault();
    if (!videoPrompt.trim() || videoLoading) return;

    setVideoLoading(true);
    setVideoError('');
    try {
      const res = await fetch('/api/media/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt.trim(),
          aspectRatio: videoAspectRatio,
          ...(videoSourcePhoto
            ? {
                imageBase64: videoSourcePhoto.base64,
                mimeType: videoSourcePhoto.mimeType,
              }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        videoDataUrl?: string;
        detail?: string;
      };
      if (!res.ok || !data.videoDataUrl) {
        setVideoError(data.detail || `Video synthesis failed (${res.status}).`);
        return;
      }
      setGeneratedVideoUrl(data.videoDataUrl);
    } catch {
      setVideoError('Network error while rendering Omni 1.1 Flash video.');
    } finally {
      setVideoLoading(false);
    }
  };

  return (
    <section id="media-studio" className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
      <div className="reveal-block flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#5df0a8] mb-2">
              Generative Scientific Media · Nano Banana 2.1 Images · Omni 1.1 Flash Video
            </p>
            <h2
              className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
              style={{ textWrap: 'balance' }}
            >
              Visual Figure &amp; Motion Studio
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Media studio modes"
            className="flex items-center gap-1 p-1 rounded-xl bg-[#080d1e] border border-[#96afe6]/18"
          >
            <button
              type="button"
              role="tab"
              aria-selected={studioMode === 'image'}
              onClick={() => setStudioMode('image')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                studioMode === 'image'
                  ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                  : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Create &amp; Edit Images</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={studioMode === 'video'}
              onClick={() => setStudioMode('video')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                studioMode === 'video'
                  ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                  : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
              }`}
            >
              <Film className="w-3.5 h-3.5 shrink-0" />
              <span>Video &amp; Photo Animation</span>
            </button>
          </div>
        </div>

        {/* =================================================================
            TAB 1: NANO BANANA 2.1 IMAGE CREATION & EDITING
        ================================================================== */}
        {studioMode === 'image' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <form
              onSubmit={(e) => void handleGenerateOrEditImage(e)}
              className="lg:col-span-5 ascend-panel rounded-2xl p-6 flex flex-col justify-between gap-5"
            >
              <div className="flex flex-col gap-4">
                <div className="text-xs text-[#6b7796]">
                  Model: <span className="font-mono-tabular text-[#f3f6ff]">gemini-nano-banana-2.1</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="img-prompt-box" className="text-xs font-medium text-[#9aa6c4]">
                    {refImage ? 'Edit Instruction Prompt' : 'Scientific Visual Prompt'}
                  </label>
                  <textarea
                    id="img-prompt-box"
                    rows={4}
                    value={imgPrompt}
                    onChange={(e) => setImgPrompt(e.target.value)}
                    maxLength={1500}
                    placeholder="Describe the figure to synthesize or how to transform the uploaded image…"
                    className="w-full p-3.5 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8] resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="img-ratio" className="text-xs text-[#6b7796]">
                      Aspect Ratio
                    </label>
                    <select
                      id="img-ratio"
                      value={imgAspectRatio}
                      onChange={(e) => setImgAspectRatio(e.target.value)}
                      className="h-10 px-3 rounded-lg bg-[#050917] border border-[#96afe6]/20 text-xs text-[#f3f6ff]"
                    >
                      <option value="16:9">16:9 Widescreen</option>
                      <option value="1:1">1:1 Square</option>
                      <option value="4:3">4:3 Presentation</option>
                      <option value="3:4">3:4 Journal Column</option>
                      <option value="9:16">9:16 Vertical</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="img-size" className="text-xs text-[#6b7796]">
                      Output Resolution
                    </label>
                    <select
                      id="img-size"
                      value={imgSize}
                      onChange={(e) => setImgSize(e.target.value as '1K' | '2K' | '4K')}
                      className="h-10 px-3 rounded-lg bg-[#050917] border border-[#96afe6]/20 text-xs text-[#f3f6ff]"
                    >
                      <option value="1K">1K Standard</option>
                      <option value="2K">2K High-DPI</option>
                      <option value="4K">4K Print Grade</option>
                    </select>
                  </div>
                </div>

                {/* Optional Upload Reference Image for Editing */}
                <div className="pt-2 border-t border-[#96afe6]/14 flex flex-col gap-2">
                  <div className="text-xs text-[#9aa6c4]">
                    Optional Reference Image (Upload to Edit)
                  </div>
                  {refImage ? (
                    <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#070c1c] border border-[#96afe6]/18">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={refImage.previewUrl}
                          alt="Reference preview"
                          className="w-10 h-10 rounded object-cover shrink-0"
                        />
                        <span className="text-xs text-[#f3f6ff] truncate">{refImage.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRefImage(null)}
                        aria-label="Remove reference image"
                        className="p-1.5 text-[#9aa6c4] hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="h-10 px-3.5 rounded-xl border border-dashed border-[#96afe6]/25 bg-[#060a18] hover:border-[#5df0a8]/50 text-xs text-[#9aa6c4] hover:text-[#f3f6ff] flex items-center justify-center gap-2 cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5 text-[#5df0a8]" />
                      <span>Upload Image to Edit (PNG / JPEG)</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleImageUpload(e, 'image-edit')}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {imgError && (
                  <div className="flex items-start gap-2 text-xs text-rose-400 leading-relaxed">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{imgError}</span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={imgLoading}
                className="mint-btn-primary h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                {imgLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Rendering {imgSize} Figure…</span>
                  </>
                ) : (
                  <span>{refImage ? 'Apply Image Edit' : 'Generate Scientific Visual'}</span>
                )}
              </button>
            </form>

            {/* Output Viewport */}
            <div className="lg:col-span-7 ascend-panel rounded-2xl p-6 flex flex-col justify-between gap-4 min-h-[360px]">
              {generatedImage ? (
                <>
                  <div className="flex-1 flex items-center justify-center rounded-xl overflow-hidden bg-[#04060f] border border-[#96afe6]/16">
                    <img
                      src={generatedImage.dataUrl}
                      alt="Generated scientific figure"
                      className="max-h-[400px] w-auto object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-[#9aa6c4] truncate">
                      {generatedImage.caption || `Rendered at ${imgSize} (${imgAspectRatio})`}
                    </p>
                    <a
                      href={generatedImage.dataUrl}
                      download="ascend-scientific-figure.png"
                      className="px-3.5 py-2 rounded-xl border border-[#5df0a8]/40 bg-[#5df0a8]/12 text-xs font-semibold text-[#5df0a8] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PNG</span>
                    </a>
                  </div>
                </>
              ) : (
                <div className="m-auto text-center max-w-sm flex flex-col items-center gap-2">
                  <ImageIcon className="w-8 h-8 text-[#6b7796]" />
                  <p className="text-sm font-medium text-[#f3f6ff]">
                    High-Resolution Figure Canvas
                  </p>
                  <p className="text-xs text-[#9aa6c4] leading-relaxed">
                    Generate bespoke conceptual illustrations up to 4K or upload an existing figure to refine labels, lighting, or visual structure.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================
            TAB 2: OMNI 1.1 FLASH VIDEO & PHOTO ANIMATION (Interactions API)
        ================================================================== */}
        {studioMode === 'video' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <form
              onSubmit={(e) => void handleGenerateVideo(e)}
              className="lg:col-span-5 ascend-panel rounded-2xl p-6 flex flex-col justify-between gap-5"
            >
              <div className="flex flex-col gap-4">
                <div className="text-xs text-[#6b7796]">
                  Interactions Engine:{' '}
                  <span className="font-mono-tabular text-[#f3f6ff]">gemini-omni-1.1-flash</span> · 720p · 5s
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="video-prompt-box" className="text-xs font-medium text-[#9aa6c4]">
                    {videoSourcePhoto
                      ? 'Camera & Motion Prompt for Uploaded Photo'
                      : 'Text-to-Video Scene Prompt'}
                  </label>
                  <textarea
                    id="video-prompt-box"
                    rows={4}
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    maxLength={1500}
                    placeholder="Describe camera movement, physical dynamics, and lighting…"
                    className="w-full p-3.5 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8] resize-none"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[#6b7796]">Video Aspect Ratio</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setVideoAspectRatio('16:9')}
                      className={`h-10 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        videoAspectRatio === '16:9'
                          ? 'border-[#5df0a8] bg-[#5df0a8]/15 text-[#5df0a8]'
                          : 'border-[#96afe6]/20 bg-[#050917] text-[#9aa6c4]'
                      }`}
                    >
                      16:9 Landscape
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoAspectRatio('9:16')}
                      className={`h-10 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        videoAspectRatio === '9:16'
                          ? 'border-[#5df0a8] bg-[#5df0a8]/15 text-[#5df0a8]'
                          : 'border-[#96afe6]/20 bg-[#050917] text-[#9aa6c4]'
                      }`}
                    >
                      9:16 Portrait
                    </button>
                  </div>
                </div>

                {/* Animate Photo into Video Upload */}
                <div className="pt-2 border-t border-[#96afe6]/14 flex flex-col gap-2">
                  <div className="text-xs text-[#9aa6c4]">
                    Optional Starting Frame (Animate Photo to Video)
                  </div>
                  {videoSourcePhoto ? (
                    <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#070c1c] border border-[#96afe6]/18">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={videoSourcePhoto.previewUrl}
                          alt="Starting frame"
                          className="w-10 h-10 rounded object-cover shrink-0"
                        />
                        <span className="text-xs text-[#f3f6ff] truncate">
                          {videoSourcePhoto.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVideoSourcePhoto(null)}
                        aria-label="Remove starting photo"
                        className="p-1.5 text-[#9aa6c4] hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="h-10 px-3.5 rounded-xl border border-dashed border-[#96afe6]/25 bg-[#060a18] hover:border-[#5df0a8]/50 text-xs text-[#9aa6c4] hover:text-[#f3f6ff] flex items-center justify-center gap-2 cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5 text-[#5df0a8]" />
                      <span>Upload Photo to Animate (PNG / JPEG)</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleImageUpload(e, 'photo-to-video')}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {videoError && (
                  <div className="flex items-start gap-2 text-xs text-rose-400 leading-relaxed">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{videoError}</span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={videoLoading}
                className="mint-btn-primary h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                {videoLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Synthesizing 5s Motion Clip…</span>
                  </>
                ) : (
                  <span>
                    {videoSourcePhoto ? 'Animate Photo to Video' : 'Generate Scientific Video'}
                  </span>
                )}
              </button>
            </form>

            {/* Video Playback Viewport */}
            <div className="lg:col-span-7 ascend-panel rounded-2xl p-6 flex flex-col justify-between gap-4 min-h-[360px]">
              {generatedVideoUrl ? (
                <>
                  <div className="flex-1 flex items-center justify-center rounded-xl overflow-hidden bg-[#04060f] border border-[#96afe6]/16">
                    <video
                      src={generatedVideoUrl}
                      controls
                      autoPlay
                      loop
                      playsInline
                      className="max-h-[400px] w-auto rounded-lg"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-[#9aa6c4]">
                      720p MP4 · {videoAspectRatio} · Rendered via Interactions API
                    </span>
                    <a
                      href={generatedVideoUrl}
                      download="ascend-motion-clip.mp4"
                      className="px-3.5 py-2 rounded-xl border border-[#5df0a8]/40 bg-[#5df0a8]/12 text-xs font-semibold text-[#5df0a8] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download MP4</span>
                    </a>
                  </div>
                </>
              ) : (
                <div className="m-auto text-center max-w-sm flex flex-col items-center gap-2">
                  <Film className="w-8 h-8 text-[#6b7796]" />
                  <p className="text-sm font-medium text-[#f3f6ff]">
                    Scientific Motion &amp; Photo Animation Stage
                  </p>
                  <p className="text-xs text-[#9aa6c4] leading-relaxed">
                    Synthesize 16:9 or 9:16 motion sequences from text prompts or upload a static microscopy, astronomical, or diagram image to animate it into video.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
