document.addEventListener('DOMContentLoaded', () => {
    // QB Form Logic (from previous steps)
    const qbForm = document.getElementById('qb-form');
    if (qbForm) {
        qbForm.addEventListener('submit', handleFormSubmit);
    }

    // Wellness Form Logic
    const wellnessForm = document.getElementById('wellness-form');
    if (wellnessForm) {
        wellnessForm.addEventListener('submit', handleWellnessSubmit);
    }
});

function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    console.log('Form Data Submitted:', data);
    alert('Data submitted! Check the console for the data.');
    form.reset();
}

function handleWellnessSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Add current date
    data.date = new Date().toISOString().split('T')[0];

    // Consolidate injury location data
    if (data.injury_concern === '0') {
        data.injury_location = '';
        data.injury_location_other = '';
    } else if (data.injury_location === 'Other') {
        data.injury_location = data.injury_location_other; // Use 'Other' text as the location
    }
    delete data.injury_location_other; // Clean up the extra field

    const scriptURL = 'https://script.google.com/macros/s/AKfycbzoJ6e2OtWYIJCuIezqoUasJM-S9mebV9LC88nQvN_FYMf7biQouHmBwC1etF9uFKkuDw/exec';

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.textContent = 'Submitting...';
    submitButton.disabled = true;

    fetch(scriptURL, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(response => {
        if (response.status === 'success') {
            alert('Wellness data submitted successfully!');
            form.reset();
            // Reset sliders to default and update their display
            const sliders = form.querySelectorAll('input[type="range"]');
            sliders.forEach(slider => {
                slider.value = slider.defaultValue;
                const valueSpan = slider.previousElementSibling.querySelector('.slider-value');
                if (valueSpan) {
                    valueSpan.textContent = slider.defaultValue;
                }
            });
            document.getElementById('injury-location-group').style.display = 'none';
        } else {
            alert('Error submitting data: ' + (response.message || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error!', error.message);
        alert('Error submitting data: ' + error.message);
    })
    .finally(() => {
        submitButton.textContent = 'Submit Wellness Data';
        submitButton.disabled = false;
    });
}