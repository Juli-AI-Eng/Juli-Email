declare global {
  var testHelpers: {
    waitForUser: (message: string) => Promise<void>;
  };
}

export {};