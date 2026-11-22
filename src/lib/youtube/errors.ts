/** Friendly text for the IFrame API `onError` codes. */
export function describeYouTubeError(code: number): string {
  switch (code) {
    case 2:
      return "That video link doesn't look right.";
    case 5:
      return 'The YouTube player had a hiccup with this video.';
    case 100:
      return "This video can't be found. It may be private or removed.";
    case 101:
    case 150:
      return 'The owner of this video turned off embedding, so it cannot play here.';
    default:
      return 'This video could not be played.';
  }
}
