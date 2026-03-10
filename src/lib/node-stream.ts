function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }
  return Buffer.from(String(chunk ?? ""));
}

export function nodeStreamToReadableStream(
  stream: NodeJS.ReadableStream,
): ReadableStream<Uint8Array> {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("close", onClose);
    stream.off("error", onError);
  };

  const closeSafely = () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      controller?.close();
    } catch {
      void 0;
    }
    cleanup();
  };

  const errorSafely = (error: unknown) => {
    if (closed) {
      return;
    }
    closed = true;
    const normalized =
      error instanceof Error ? error : new Error(String(error ?? "Stream failed."));
    try {
      controller?.error(normalized);
    } catch {
      void 0;
    }
    cleanup();
  };

  const onData = (chunk: unknown) => {
    if (closed || !controller) {
      return;
    }
    try {
      controller.enqueue(toUint8Array(chunk));
    } catch (error) {
      errorSafely(error);
    }
  };

  const onEnd = () => {
    closeSafely();
  };

  const onClose = () => {
    closeSafely();
  };

  const onError = (error: unknown) => {
    errorSafely(error);
  };

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("close", onClose);
      stream.on("error", onError);
    },
    cancel() {
      cleanup();
      closed = true;
      const destroy = (stream as { destroy?: () => void }).destroy;
      if (typeof destroy === "function") {
        destroy.call(stream);
      }
    },
  });
}
