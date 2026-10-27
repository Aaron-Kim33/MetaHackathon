import sharp from 'sharp';

// Original vector artwork created for coordinate tests; never represented as a SAM result.
export async function fixture() {
  const shape = `<ellipse cx="400" cy="235" rx="94" ry="113" fill="#242d45"/><ellipse cx="400" cy="255" rx="74" ry="87" fill="#db9d7c"/><path d="M324 238 Q325 107 438 148 Q500 165 477 250 L446 188 Q383 225 324 238" fill="#242d45"/><path d="M370 326h60v80h-60z" fill="#db9d7c"/><path d="M270 430 Q285 356 365 361 L400 395 436 361 Q521 361 540 430 L577 655 497 665 470 520 480 1020H320L330 520 303 665 223 655Z" fill="#7768da"/><path d="M271 430 L202 306 171 323 223 535Z" fill="#7768da"/><path d="M202 306 L175 266 Q159 250 151 268 L151 313 171 323Z" fill="#db9d7c"/><path d="M540 430 L622 318 648 342 577 535Z" fill="#7768da"/><path d="M622 318 L631 271 Q645 250 656 270 L668 313 648 342Z" fill="#db9d7c"/><path d="M320 1000L312 1160H386L400 1010 414 1160H488L480 1000Z" fill="#242d45"/><circle cx="374" cy="253" r="5" fill="#242d45"/><circle cx="426" cy="253" r="5" fill="#242d45"/><path d="M379 289 Q401 308 423 289" fill="none" stroke="#9d5347" stroke-width="5" stroke-linecap="round"/>`;
  const wrap = content => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">${content}</svg>`);
  return {
    width: 800, height: 1200,
    bytes: await sharp(wrap(`<rect width="800" height="1200" fill="#cbded8"/><circle cx="690" cy="220" r="150" fill="#e9d5a9"/><path d="M0 920Q230 800 800 930V1200H0Z" fill="#a0bcb2"/>${shape}`)).png().toBuffer(),
    cutout: await sharp(wrap(shape)).png().toBuffer(),
  };
}
