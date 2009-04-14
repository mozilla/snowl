// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/feed.js");

function run_test() {
  let server = new Httpd.nsHttpServer();
  let basePath = do_get_file("test/unit/");
  server.registerDirectory("/", basePath);
  server.start(8080);

  do_test_pending();

  let feed = new SnowlFeed(null, null, new URI("http://localhost:8080/feed.xml"), undefined, null);
  Observers.add("snowl:subscribe:get:end", finish_test);
  feed.subscribe();
}

function finish_test() {
  server.stop();
  do_test_finished();
  // FIXME: delete messages.sqlite
}
