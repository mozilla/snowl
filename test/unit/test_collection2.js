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

function continue_test() {
  feed.persist();
  let collection = new StorageCollection();

  for each (let message in collection) {
    do_check_eq(message.id.constructor.name, "Number");
  }

  do_test_finished();
}
