git archive --format=zip HEAD -o "../$(basename $(git rev-parse --show-toplevel))-$(date +%Y%m%d).zip"
