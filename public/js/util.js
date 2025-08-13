// 修正后的toJED函数
function toJED(d) {
    // 计算UTC时间戳对应的天数（保留小数）
    const daysSinceEpoch = d.getTime() / (1000 * 60 * 60 * 24);
    // 转换为JED（使用四舍五入避免整数时间戳的取整误差）
    return Math.round(daysSinceEpoch) + 2440587.5;
    // 注：2440587.5是1970-01-01 UTC对应的JED，比原代码更准确
}

// 保持fromJED函数不变（因jed_delta=0，后续不会变化）
function fromJED(jed) {
  return new Date(1000*60*60*24 * (0.5 - 2440588 + jed));
}

function getColorFromPercent(value, highColor, lowColor) {
    var r = highColor >> 16;
    var g = highColor >> 8 & 0xFF;
    var b = highColor & 0xFF;

    r += ((lowColor >> 16) - r) * value;
    g += ((lowColor >> 8 & 0xFF) - g) * value;
    b += ((lowColor & 0xFF) - b) * value;

    return (r << 16 | g << 8 | b);
}

function displayColorForObject(roid) {
  /*
  if (roid.profit > 1e11)
    return new THREE.Color(0xffff00);
    */
  return new THREE.Color(0xffffff);

  /*
  var normal = parseFloat(1e11);
  if (roid.profit < 1)
    return new THREE.Color(0xcccccc);

  var adjustment = roid.profit / normal;
  console.log(adjustment);
  var ret = new THREE.Color(getColorFromPercent(
    adjustment,
    0x00ff00,
    0xcccccc

  ));
  // TODO change size too
  return ret;
  */
}

function getParameterByName(name) {
  name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
  var regexS = "[\\?&]" + name + "=([^&#]*)";
  var regex = new RegExp(regexS);
  var results = regex.exec(window.location.search);
  if(results == null)
    return "";
  else
    return decodeURIComponent(results[1].replace(/\+/g, " "));
}

window.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
window.isIframe = window.self !== window.top;
