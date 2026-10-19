// CloudFront Function (cloudfront-js-2.0), viewer-request on the S3 (default) behavior of the frontend
// distribution — /api/* has its own behavior and never runs this. Loaded by marketing.tf with file();
// unit-tested in apps/api/src/infra-cloudfront-function.test.ts.
//
// [P30] www.<apex> → 301 to https://<apex> with the same path + query (one canonical host). Any other host
//       (the apex, staging.tovira.io) is served as-is.
// Directory-index for the prerendered marketing pages: an S3 REST origin does not auto-append index.html,
// so `/privacy` and `/terms` (dotless) map to `.../index.html`. Static assets (a dot in the path) pass
// through. Everything else dotless is an app client-side route and is served the app shell.
var MARKETING = ['/privacy', '/terms'];

function queryString(qs) {
  var parts = [];
  for (var key in qs) {
    var entry = qs[key];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) {
      parts.push(values[i].value === '' ? key : key + '=' + values[i].value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
  var req = event.request;
  var host = req.headers.host ? req.headers.host.value.toLowerCase() : '';
  if (host.indexOf('www.') === 0) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://' + host.slice(4) + req.uri + queryString(req.querystring || {}) } },
    };
  }
  var uri = req.uri;
  if (uri.indexOf('.') !== -1) { return req; }           // real static asset
  if (uri === '/') { req.uri = '/index.html'; return req; }
  var trimmed = uri.endsWith('/') ? uri.slice(0, -1) : uri;
  if (MARKETING.indexOf(trimmed) !== -1) {               // prerendered marketing page
    req.uri = trimmed + '/index.html';
    return req;
  }
  req.uri = '/app.html';                                 // app client-side route
  return req;
}
