function copyToClipboard(text, buttonElement) {
    navigator.clipboard.writeText(text).then(() => {
        const originalHTML = buttonElement.innerHTML;
        // Checkmark icon
        buttonElement.innerHTML = `<svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        
        setTimeout(() => {
            buttonElement.innerHTML = originalHTML;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}
