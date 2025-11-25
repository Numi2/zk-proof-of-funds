import React from 'react';

const Footer = (): React.JSX.Element => {
  return (
    <footer className="w-full py-6 flex items-center justify-center font-medium">
      <div className="flex items-center text-xs">
        <span className="block text-xs">Made by Numan - inspired heavily by webzjs - vendored keys + wasm.</span>
      </div>
    </footer>
  );
};

export default Footer;
