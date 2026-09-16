import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
function Page({
  doc,
  n,
  onError,
}: {
  doc: PDFDocumentProxy;
  n: number;
  onError: (e: unknown) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          setVisible(true);
          o.disconnect();
        }
      },
      { rootMargin: "600px" },
    );
    if (holder.current) o.observe(holder.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    doc
      .getPage(n)
      .then((page) => {
        if (cancelled || !ref.current) return;
        const canvas = ref.current;
        const viewport = page.getViewport({ scale: 1.6 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        task = page.render({ canvas, viewport });
        return task.promise.then(() => {
          canvas.dataset.rendered = "true";
        });
      })
      .catch((e) => {
        if (!cancelled && e.name !== "RenderingCancelledException") onError(e);
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, visible]);
  return (
    <div ref={holder} className="pdf-page">
      <span>
        {n} / {doc.numPages}
      </span>
      <canvas ref={ref} />
    </div>
  );
}
export default function PdfView({
  id,
  onError,
}: {
  id: string;
  onError: (e: unknown) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  useEffect(() => {
    let disposed = false;
    let loaded: PDFDocumentProxy | undefined;
    window.makale
      .call<string>("pdf", id)
      .then(async (b64) => {
        loaded = await getDocument({
          data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
        }).promise;
        if (disposed) await loaded.destroy();
        else setDoc(loaded);
      })
      .catch(onError);
    return () => {
      disposed = true;
      setDoc(undefined);
      void loaded?.destroy();
    };
  }, [id]);
  return (
    <div className="pdf-view">
      {doc ? (
        Array.from({ length: doc.numPages }, (_, i) => (
          <Page key={i} doc={doc} n={i + 1} onError={onError} />
        ))
      ) : (
        <div className="loader" />
      )}
    </div>
  );
}
