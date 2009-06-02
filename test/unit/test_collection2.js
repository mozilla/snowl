// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/collection2.js");
Cu.import("resource://snowl/modules/feed.js");

let server;
let feed;
let refreshTime = new Date();
let feedURI = new URI("http://localhost:8080/feed.xml");

function run_test() {
  server = new nsHttpServer();
  let basePath = do_get_file("test/unit/");
  server.registerDirectory("/", basePath);
  server.start(8080);

  do_test_pending();

  feed = new SnowlFeed(null, null, feedURI, undefined, null);
  feed.refresh(refreshTime, do_callback(continue_test));
}

let collection;
function continue_test() {
  feed.persist();
  collection = new Collection2(do_callback(finish_test));
}

function finish_test() {
  dump("finish_test\n");
  
  for each (let message in collection) {
    dump("message: " + message + "\n");
    dump("message.id: " + message.id + "\n");
  }

  do_test_finished();
}
