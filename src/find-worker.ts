import { searchSource, type SearchRequest } from "./find-engine";
self.onmessage = (event: MessageEvent<SearchRequest>) => {
  try { self.postMessage({ result: searchSource(event.data) }); }
  catch (error) { self.postMessage({ error: String(error) }); }
};
