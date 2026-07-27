@echo off
title CHArT5k-Puppet Tunnel Manager
echo Cleaning up existing ngrok instances...
taskkill /f /im ngrok.exe >nul 2>&1
cd C:\CHArT5k-Puppet
echo Starting ngrok tunnel using config: ngrok-harmless.yml...
echo Alternatives if default yml does not exist and does not apply here:
echo Poole: ngrok start --all --config ngrok-doormat.yml
echo Witney: ngrok start --all --config ngrok-shivering.yml
ngrok start --all --config ngrok-harmless.yml
pause
