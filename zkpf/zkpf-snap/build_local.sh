#!/bin/bash

# Script to build the snap with localhost development origins

echo "Adding localhost:3000 to allowed origins in snap.manifest.json..."

# Use jq to modify the allowedOrigins array to include localhost:3000
jq '.initialPermissions."endowment:rpc".allowedOrigins = ["https://zkpf.dev", "https://www.zkpf.dev", "http://localhost:3000", "http://localhost:5173"]' snap.manifest.json > snap.manifest.json.tmp

# Replace the original file with the modified version
mv snap.manifest.json.tmp snap.manifest.json

echo "Modified snap.manifest.json to include localhost for local development"

# Run the build command
echo "Running build..."
yarn build

echo "Build completed!"

