set -eu
cd /work
tar --extract --file /snapshot.tar --no-same-owner --no-same-permissions
cmp package.json /opt/dependencies/package.json && cmp package-lock.json /opt/dependencies/package-lock.json || exit 78
ln -s /opt/dependencies/node_modules node_modules
node --test --test-concurrency=1 'test/unit/**/*.test.js'
npm run build
