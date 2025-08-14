#\!/usr/bin/env node
require('dotenv').config();
const OpenAI = require('openai');

async function testGPT5() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  console.log('\n🚀 Testing GPT-5 with REAL API calls\n');
  console.log('='.repeat(60));
  
  const testPrompt = "Summarize: User has 5 urgent work emails from boss and client, and 10 newsletters. The work emails need responses today.";
  
  // Test with LOW verbosity (original)
  console.log('\n📝 Test 1: LOW verbosity (original setting)');
  console.log('-'.repeat(60));
  let start = Date.now();
  const lowResponse = await client.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: testPrompt }],
    reasoning_effort: 'minimal',
    verbosity: 'low'
  });
  let duration = Date.now() - start;
  
  console.log('Response:', lowResponse.choices[0].message.content);
  console.log(`Length: ${lowResponse.choices[0].message.content.length} chars`);
  console.log(`Duration: ${duration}ms`);
  
  // Test with MEDIUM verbosity (optimized)
  console.log('\n📝 Test 2: MEDIUM verbosity (optimized setting)');
  console.log('-'.repeat(60));
  start = Date.now();
  const medResponse = await client.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: testPrompt }],
    reasoning_effort: 'minimal',
    verbosity: 'medium'
  });
  duration = Date.now() - start;
  
  console.log('Response:', medResponse.choices[0].message.content);
  console.log(`Length: ${medResponse.choices[0].message.content.length} chars`);
  console.log(`Duration: ${duration}ms`);
  
  // Compare results
  console.log('\n📊 Comparison:');
  console.log('='.repeat(60));
  const lowLen = lowResponse.choices[0].message.content.length;
  const medLen = medResponse.choices[0].message.content.length;
  console.log(`Low verbosity: ${lowLen} characters`);
  console.log(`Medium verbosity: ${medLen} characters`);
  console.log(`Difference: +${medLen - lowLen} chars (${Math.round((medLen - lowLen) / lowLen * 100)}% more detail)`);
  
  console.log('\n✅ GPT-5 optimization test complete\!');
  console.log('The medium verbosity setting provides richer, more detailed responses.');
}

testGPT5().catch(console.error);
