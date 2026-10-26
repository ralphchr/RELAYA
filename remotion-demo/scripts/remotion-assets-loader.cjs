// Adapt the original component's root-relative asset URL at bundle time only.
// The source application and its component implementation remain untouched.
module.exports = function (source) {
  return source.replace('"/assets/relaya-logo.png"', 'require("remotion").staticFile("assets/relaya-logo.png")');
};
