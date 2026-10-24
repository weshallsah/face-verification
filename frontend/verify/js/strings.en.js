// ALL user-facing text for /verify. To add a language, copy this file to strings.<code>.js, translate the
// values (keep keys, {placeholders} and function signatures), and register it in strings.js.
// Strings marked [new] are not in the design export and were drafted for the same tone.

export default {
  lang: 'en',

  common: {
    back: 'Back',
    close: 'Close',
    tip: 'Tip',
  },

  welcome: {
    title: 'We love your privacy',
    sub: 'A quick face check keeps our community free of bots and fake accounts. One person, one account.',
    heroLabel: 'A heart with a lock',
    cards: [
      { icon: 'cameraOff', title: 'We never store your photos', text: 'Your camera images are deleted right after the check.' },
      { icon: 'shieldKey', title: 'Only a face code is kept, not your photo.', text: "It's used only to make sure each person has one account." },
      { icon: 'clock', title: 'Takes about 10 seconds', text: 'Just look at the camera and move your head.' },
    ],
    privacyLink: 'Read our privacy policy',
    start: "Let's start",
  },

  privacy: {
    title: 'Your privacy, in short',
    body: 'We use your camera only during the check. Photos and video are deleted right away. We keep a face code, not your photo, so one person can only have one account.',
    fullPolicy: 'Read the full privacy policy',
    close: 'Close',
  },

  tutorial: {
    title: 'How it works',
    demoLabel: 'Animation: a face fits in the oval, holds still, moves in a circle, looks straight again, then a green check appears',
    demoCaptions: ['Fit your face and hold still', 'Move your head in a circle', 'Look straight again', 'Done!'],
    steps: [
      'Fit your face in the oval and hold still',
      'Slowly move your head around in a circle',
      "Look straight again, and you're done",
    ],
    bestTitle: 'For the best result',
    dos: [
      { art: 'goodLight', ok: true, label: 'Good light on your face' },
      { art: 'badLight', ok: false, label: 'Bright light behind you' },
      { art: 'fullFace', ok: true, label: 'Face fully visible' },
      { art: 'covered', ok: false, label: 'Sunglasses, mask or cap' },
      { art: 'onlyYou', ok: true, label: 'Only you in the frame' },
      { art: 'otherPeople', ok: false, label: 'Other people in view' },
    ],
    okLabel: 'Do',
    noLabel: "Don't",
    note: "It doesn't need to be a perfect circle. Just move naturally.",
    openCamera: 'Open camera',
  },

  permission: {
    title: 'We need your camera for a few seconds',
    points: ['Used only for this check', 'No photos or video are recorded or saved.'],
    note: 'Your browser will ask for permission next. Please choose "Allow".',
    allow: 'Allow camera',
  },

  denied: {
    title: 'Camera access is off',
    text: "We can't start the check without your camera. You can turn it on in a few steps.",
    browserTitle: 'In your browser',
    browserSteps: ['Tap the lock icon next to the web address', 'Find "Camera" and choose "Allow"', 'Reload the page if asked'],
    appTitle: 'In the app',
    appSteps: ["Open your phone's Settings", 'Find {appName} and open Permissions', 'Turn on Camera, then come back here'],
    retry: 'Try again',
  },

  camera: {
    close: 'Close the camera',
    stepLabel: (n) => `Step ${n} of 3 · ${['Position', 'Move', 'Done'][n - 1]}`,
    hint: 'Images are deleted right after the check',
    status: 'Camera instructions',
    // Live messages, keyed by guidance.js
    msg: {
      fit: 'Fit your face in the oval',
      closer: 'Move closer',
      back: 'Move back a little',
      centre: 'Centre your face',
      multi: 'Only one face please',
      dark: 'Too dark, find more light',
      bright: 'Too bright, avoid strong light',          // [new]
      lookStraight: 'Look straight at the camera',        // [new] (wording from the old test page)
      relax: 'Relax your face',                           // [new]
      openEyes: 'Open your eyes',                         // [new]
      cover: 'Remove sunglasses or mask',                 // dev preview only: covering is only detected by the server
      hold: 'Hold still…',
      move: 'Slowly move your head around in a circle',
      keepGoing: 'Keep going, move slowly',
      returnGreat: 'Great! Now look straight again',
      captured: 'Got it!',
      retry: "Let's try once more, move a little further",
    },
  },

  starting: {                                             // [new]
    title: 'Starting camera…',
    text: 'This only takes a moment.',
  },

  processing: {
    title: 'Verifying…',
    lines: ["Checking it's really you", 'Making sure this face is unique', 'Almost done'],
    keepOpen: 'Please keep this screen open',
  },

  // Result screens. `tip` is the default tip; verdict.js may pick another one from `tips`.
  result: {
    verified: { title: "You're verified!", text: 'Welcome to a community of real people.', primary: 'Continue' },
    duplicate: { title: 'This face is already linked to an account', text: 'Our policy allows one account per person.', primary: 'Log in to my account', secondary: 'I think this is a mistake' },
    review: { title: 'We need a little more time', text: "Our team will review your verification. We'll notify you soon.", primary: 'Got it' },
    already: { title: "You're already verified", text: 'Your account is verified. There is nothing else to do.', primary: 'Continue' },
    notLive: { title: "We couldn't confirm it's a live person", text: "Please use your phone's front camera directly, in good light.", primary: 'Try again' },
    limit: {
      title: 'Please take a short break',
      text: (minutes) => `You can try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
      countdownLabel: 'until you can try again',
      primary: 'Try again',
    },
    connection: { title: 'Something went wrong on our side', text: "Your attempt wasn't counted. Please try again.", primary: 'Try again' },

    // Retryable
    retryText: 'This happens sometimes. You can try again now.',
    retryPrimary: 'Try again',
    retrySecondary: 'See tips',
    'retry.movement': { title: "We couldn't see enough head movement", tip: 'movement' },
    'retry.blurry': { title: 'Your picture was blurry', tip: 'blurry' },                         // [new]
    'retry.dark': { title: 'It was too dark', tip: 'dark' },                                    // [new]
    'retry.bright': { title: 'It was too bright', tip: 'bright' },                              // [new]
    'retry.covered': { title: 'Your face was covered', tip: 'covered.sunglasses' },
    'retry.far': { title: 'Your face was too far', tip: 'far' },
    'retry.noFace': { title: "We couldn't see your face clearly", tip: 'noFace' },              // [new]
    'retry.multi': { title: 'More than one face was in view', tip: 'multi' },                   // [new]
    'retry.notNeutral': { title: 'Please look straight at the camera', tip: 'notNeutral' },     // [new]
    'retry.generic': { title: "Let's try that again", tip: 'generic', text: 'Something got in the way of the check. You can try again now.' }, // [new]
  },

  tips: {
    movement: 'Move your head a bit further in each direction.',
    blurry: 'Hold the phone steady and stay still.',                                             // [new]
    dark: 'Face a window or a lamp so the light falls on your face.',                            // [new]
    bright: 'Avoid strong light behind you or straight on your face.',                           // [new]
    'covered.sunglasses': 'Remove sunglasses, a mask or a cap.',
    'covered.hand': 'Keep your hands away from your face.',                                      // [new]
    'covered.other': 'Make sure nothing is covering your face.',                                 // [new]
    far: 'Hold the phone a little closer to your face.',
    noFace: 'Keep your face inside the oval for the whole check, and face a light.',             // [new]
    multi: 'Make sure only you are in the frame.',                                               // [new]
    notNeutral: 'Relax your face and look straight ahead at the start and at the end.',         // [new]
    generic: 'Face a light, hold the phone steady and move your head slowly.',                   // [new]
  },

  // Screens for situations the design export does not cover. [new]
  states: {
    unsupported: {
      title: "This browser can't run the check",
      text: 'Please open this page in an up-to-date Chrome, Safari or Edge, or use the app.',
      insecure: 'The camera only works on a secure (HTTPS) page. Please open the secure link.',
      primary: 'Go back',
    },
    noCamera: { title: "We can't find a camera", text: 'The check needs a front camera. Please use a phone or laptop with one.', primary: 'Try again' },
    cameraFailed: { title: "The camera didn't start", text: 'Check your camera settings, then try again.', primary: 'Try again' },
    cameraBusy: { title: 'The camera is in use', text: 'Close other apps that use the camera, then try again.', primary: 'Try again' },
    loadFailed: { title: "The face check didn't load", text: "Check your connection and try again. Your attempt wasn't counted.", primary: 'Try again' },
    rotate: { title: 'Rotate your phone', text: 'Hold your phone upright to continue the check.' },
  },

  a11y: {
    loading: 'Loading',
  },
};
