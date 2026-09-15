# First-board evaluation (no Refresh)

Model v3 (SmolLM2-135M + 16 folder rows, dead mask) with the 54-dim reranker, board built as in the web app (Topic 9 / Action 6 / Feeling 3 + core row + up to 2 folder cards). 80 questions, 8 settings, from `eval/board_bank.json`. Personal profile empty. Run: `python3 eval/board_eval.py`.

A question **passes** when one of its expected answer cards is on the first board. *Direct* = the card itself is visible; *via folder* = a folder card on the board contains it (one more tap); *miss* = only reachable with Refresh or search.

| setting | questions | direct | via folder | miss | pass rate |
|---|---|---|---|---|---|
| home | 10 | 9 | 1 | 0 | 100% |
| school | 10 | 10 | 0 | 0 | 100% |
| restaurant | 10 | 10 | 0 | 0 | 100% |
| doctor | 10 | 10 | 0 | 0 | 100% |
| play | 10 | 10 | 0 | 0 | 100% |
| transport | 10 | 10 | 0 | 0 | 100% |
| selfcare | 10 | 9 | 1 | 0 | 100% |
| unknown | 10 | 10 | 0 | 0 | 100% |
| all | 80 | 78 | 2 | 0 | 100% |

## Every question

| setting | question | result | expected cards found | best model rank of an expected card | board (Topic / Action / Feeling) |
|---|---|---|---|---|---|
| home | What do you want for breakfast? | direct | toast, pancakes | 6 | 📁 Food, Oatmeal, Pancakes, Jam, Syrup, Coffee, Tea, I, I want / Toast, Want, Wake, Add, Break, Make / Cold, Love, Calm |
| home | Do you want to watch TV or play outside? | direct | tv, outside, play, watch | 3 | 📁 Toys & games, Tv, Outside, Game, Chess, I, Sound, Dinner, Homework / Play, Puzzle, To watch, Watch, Sport, Breathe / Great, Starving, Shy |
| home | How did you sleep? | direct | good, tired, well | 14 | 📁 Everyday routines, Nap, I, Good, Oh, Not, Well, How, Yeah / Sleep, Wake, Breathe, Went, Get, Saw / Tired, Great, Restless |
| home | Can you help me set the table? | direct | yes, no, help | 2 | 📁 Ready phrases, Sure, Yeah, I have, I, Can, Dinner, Table, When / Set, Let, Need, Bring, Try, Get / Ok, I'm fine, Love |
| home | Where is your jacket? | direct | i don't know | 32 | 📁 Clothing, Here, Inside, Jacket, Coat, I, It's, The, Back / Dress, Ring, Fix, Found, To hear, Hear / Calm, Silly, Cold |
| home | What do you want to do this weekend? | folder | folder Asking for things → play, movie | 36 | 📁 Asking for things, I want, I want to go, I need, I want to read, I, To, Dinner, Pizza / Want, Talk, To go, Need, Watch, Go / Love, Like, Calm |
| home | Are you hungry? | direct | yes, no, hungry | 1 | 📁 Food, Food, Lunch, I, I am, I'm, Not, Good, Morning / Need, Time, Bite, Want, Eat, Look / I'm hungry, Hungry, Excited |
| home | Which cup do you want, the blue one or the red one? | direct | blue, red | 9 | 📁 Colours, Cup, Blue, Red, Color, Purple, I, One, The / Go, Watch, Carry, Die, Trim, Let / Feel, Great, Love |
| home | Time to clean your room. Ready? | direct | yes, no | 2 | 📁 Ready phrases, Oh, Let's, Definitely, I, Ready, Good, Morning, Maybe / Need, Clean, Let, Make, Get, Prepare / Excited, I'm hungry, Hungry |
| home | Who is coming for dinner? | direct | friend, i don't know | 41 | 📁 Food, Friend, Mom, Dinner, Food, I, What, Family, I'm / Need, Meet, Time, Want, Come, Cook / Hope, I'm hungry, Hungry |
| school | What did you learn today? | direct | math | 10 | 📁 Tools & work, Machine, I, Learn, Math, The, Good, Lesson, Dog / Saw, Paint, Work, Watch, Catch, Dance / Mad, Silly, Excited |
| school | Who did you play with at recess? | direct | friend, teacher | 27 | 📁 Toys & games, Friend, Teacher, Game, Me, I, School, Kid, Different / Play, Cheat, Make, Ring, Dance, Laugh / Silly, Like, I'm fine |
| school | Do you want to read or draw? | direct | read, draw | 14 | 📁 Music & art, Book, Art, Harp, I, To, Drawer, What, Pencil / Read, Draw, Drama, Write, Want, Need / Nervous, Like, Brave |
| school | What colour is the apple? | direct | red | 4 | 📁 Colours, Red, Brown, Purple, Tan, Apple, Berry, Orange juice, Strawberry / Ring, Bite, To hear, Grab, Hear, Answer / Like, Cheerful, Angry |
| school | How many blocks do you have? | direct | one, two, four, ten | 10 | 📁 Numbers, Two, Ten, Four, One, I, I'll, Block, Have / Need, Want, Let, See, Take, Know / Ok, Fine, Comfort |
| school | Do you need help with your work? | direct | yes, no, help, please | 1 | 📁 Tools & work, I, Can, Definitely, I need help, I need, Can I, Yeah, I'm / Work, Nail, File, To work, Need, Get / Ok, Excited, I'm hungry |
| school | What do you want to do first, maths or writing? | direct | math, write | 3 | 📁 School, Math, Science, Paper, Homework, I, First, To, I'm / Write, Start, Need, Swim, Bingo, Dance / Love, Wish, Mood |
| school | Are you ready for the test? | direct | yes, no, ready | 2 | 📁 Ready phrases, I am, I'm, Definitely, I, Not yet, Not, Ready, Good / Prepare, Need, Let, Time, Wait, Bite / Excited, Feel, Great |
| school | What is your favourite subject? | direct | math, art, music, science | 2 | 📁 School, Math, Science, Music, Art, I, The, It's, Good / Project, Football, Understand, Volunteer, Sew, Acting / Feel, Excited, Love |
| school | Did you finish your homework? | direct | yes, no, not yet | 3 | 📁 Ready phrases, Yeah, Oh, I'm, I, Not yet, Did, Finish, Sorry / Need, Hear, Get, Work, Sleep, Guess / Tired, Ok, Sleepy |
| restaurant | What would you like to eat? | direct | pizza, pasta | 2 | 📁 Food, Pasta, Tuna, Pizza, Pancakes, I, Turkey, I want, Sounds good / Toast, Want, Bite, Break, Try, To go / Hurt, Great, Ok |
| restaurant | Anything to drink? | direct | water, soda | 3 | 📁 Drinks, Orange juice, Water, Soda, Wine, Anything, I, Orange, Teaspoon / Carry, Let, Need, Want, Fix, Know / Cold, Feel, Comfort |
| restaurant | Do you want fries or salad with that? | direct | salad | 2 | 📁 Food, Salad, Chips, French fries, Dip, Sound, Sounds good, With, Healthy / Discuss, Fix, Dress, Dial, Bite, Deal / Disgust, Hurt, Feel |
| restaurant | Would you like dessert? | direct | yes, no, ice cream | 6 | 📁 Food, Dessert, Sweet, Ice cream, Chocolate, Not, Sound, You, Definitely / Treat, Need, Let, Time, Thank, Melt / Feel, Fine, Like |
| restaurant | Is your food okay? | direct | yes, no, good | 2 | 📁 Food, Good, Food, Taste, I, Yeah, Not, It is, Tasty / Mix, Need, Time, Try, Eat, Sit / Tired, Ok, Great |
| restaurant | Do you want ketchup? | direct | yes, no, please, ketchup | 2 | 📁 Ready phrases, I love, Sure, Yeah, Ketchup, I, Spicy, Do you, You / Try, Chop, Let, Put, Mix, Make / Love, Great, Cold |
| restaurant | Would you like to sit inside or outside? | direct | inside, outside | 18 | 📁 Shapes & where, Inside, Outside, In, Under, Side, Out, I, Warm / Sit, To sit, Stand, Live, Sleep, Sell / Fine, Shy, Uncomfortable |
| restaurant | Are you finished? | direct | yes, no, more | 2 | 📁 Ready phrases, I'm, I am, Yeah, I, Not yet, Finish, Not, Busy / Need, Start, Set, Close, Get, Eat / Tired, Feel, Excited |
| restaurant | What flavour ice cream? | direct | chocolate, strawberry | 2 | 📁 Food, Chocolate, Mango, Strawberry, Chip, I, Orange juice, Black, Turkey / Melt, Let, Go, Allow, Bite, Pour / Love, Calm, Cold |
| restaurant | Do you want a big one or a small one? | direct | big, small | 19 | 📁 Food, Big, Small, Muffin, Snack, Biscuits, Butter, One, A / Bite, Baseball, Deal, Football, Smell, Sell / Great, Like, Calm |
| doctor | Where does it hurt? | direct | head | 6 | 📁 Body, Inside, Here, Head, Hair, A, I, Low, It's / To hear, Hear, Ring, Football, Fight, Fly / Hurt, Feel, Stressed |
| doctor | How are you feeling today? | direct | tired, okay, good | 7 | 📁 Feelings, Good, I, I feel, I am, Not, Okay, I have, I'm / Bite, Need, Seem, Wake, Mix, To talk / Tired, Nervous, Feel |
| doctor | Does your ear hurt? | direct | yes, no, ear, hurt | 2 | 📁 Body, Ear, Eyes, I, Oh, Not, It's, Sound, Sorry / Hear, To hear, Need, Make, Get, Check / Feel, Hurt, Ok |
| doctor | Can I look in your mouth? | direct | yes, no | 1 | 📁 Ready phrases, Sure, Of course, Oh, I, Can, Can you, What, Good / Let, Check, Bring, Make, Smell, Take / Love, Like, I'm hungry |
| doctor | Are you scared of the needle? | direct | yes, no, scared | 2 | 📁 Ready phrases, Sure, I am, Definitely, I, Not, Why, What, Scary / Need, Try, Hear, Bite, Course, Carry / Afraid, Fine, Scared |
| doctor | Did you throw up? | direct | yes, no | 2 | 📁 Ready phrases, Yeah, Oh, I saw, I, Not, Not yet, Sorry, Good / Get, Need, Throw, Hear, Football, Think / Tired, Upset, Ok |
| doctor | Do you feel hot or cold? | direct | hot, cold | 31 | 📁 Feelings, I, Warm, Temperature, Sunny, Ice, It's, I like, He / Need, Bite, Melt, Chop, To get, Sit / Hot, Cold, Tired |
| doctor | What did you eat this morning? | direct | toast | 32 | 📁 Food, Pasta, Salad, Oatmeal, Pizza, I, Tea, I want, Turkey / Toast, Want, Bite, Saw, Eat, Sit / Cold, Ok, Hurt |
| doctor | Do you want mum to hold your hand? | direct | yes, no, mum, please | 7 | 📁 Ready phrases, Sure, Oh, Definitely, I, Not, I want, Mum, Always / Let, Need, Thank, Take, Make, Ask / Love, Happy, I'm hungry |
| doctor | How many days have you been sick? | direct | one, two, i don't know | 24 | 📁 Numbers, Two, One, Six, Ten, I, I have, Since, Days / Time, Need, Let, Hear, Forget, Start / Hope, Sick, Tired |
| play | What do you want to play? | direct | game, puzzle, outside | 45 | 📁 Toys & games, Outside, Chess, Game, I, Playlist, The, Harp, Band / Puzzle, Soccer, Football, Play, Dance, Catch / Calm, Silly, Alarm |
| play | Do you want the swing or the slide? | direct | swing, slide | 2156 | 📁 Home & furniture, Floor, Table, Lawn, The, Wing, Squirrel, Slice, Ice / Swing, Slide, Lift, Roll, Escape, Arrive / Calm, Silly, Mad |
| play | Whose turn is it? | direct | me | 52 | 📁 People, Me, Friend, Player, Kid, I, Turn, It's, The / To hear, Need, See, Ring, Let, Arrive / I'm tired, Silly, Cheerful |
| play | Are you having fun? | direct | yes, no, fun | 2 | 📁 Ready phrases, Yeah, Oh, I am, I, Good, Not, Totally, Sound / Fun, Need, Time, Seem, Acting, Think / Feel, Tired, Love |
| play | Do you want to go higher? | direct | yes, no, stop, more | 5 | 📁 Ready phrases, I'm, I'll, I have, I, You, Good, How, What / Go, Let, To go, Need, Get, Ask / Hope, Fine, Ok |
| play | Shall we play with the ball or the bubbles? | direct | ball, bubbles | 1963 | 📁 Toys & games, Ball, Bubbles, Outside, Game, Sound, We, I'll, With / Puzzle, Bingo, Basketball, Baseball, Play, Laugh / Love, Wish, Great |
| play | Can I play too? | direct | yes, no | 1 | 📁 Toys & games, Outside, Game, I, Yeah, Can, Definitely, I'll, Sound / Puzzle, Bingo, Play, Let, Make, Plan / Feel, Like, Fine |
| play | Do you want to be the pirate or the dragon? | direct | pirate, dragon | 2715 | 📁 Animals, Pirate, Dragon, Pig, Puppy, Spider, The, One, Superhero / Fly, Escape, Admire, Roll, Drama, Pull / Joy, Angry, Silly |
| play | Are you tired yet? | direct | yes, no, tired, more, not yet | 7 | 📁 Feelings, I, Not, Not yet, Yeah, I am, Good, I'm, Okay / Need, Bite, Sleep, Time, Wake, Think / Tired, I'm tired, Restless |
| play | Which colour crayon do you want? | direct | blue, green, pink, black | 3 | 📁 Colours, Blue, Pink, Green, Black, I, Bright, You, One / Want, Paint, Brush, See, Pour, Need / Calm, Like, Cheerful |
| transport | Where are we going? | direct | home, i don't know | 73 | 📁 Places, Here, Home, Zoo, Cafe, I, To, How, I'm / Go, Went, Sleep, Move, Want, To move / Feel, Excited, Nervous |
| transport | Do you want to sit by the window? | direct | yes, no, window, please | 2 | 📁 Ready phrases, I have, Sure, Yeah, I, I want, Window, Not, Sound / To sit, Sit, Let, Stand, Take, Smell / Fine, Ok, Shy |
| transport | Are you feeling sick in the car? | direct | yes, no, sick | 3 | 📁 Ready phrases, Oh, I, Not, Always, Car, It's, I need, Much / Need, Seem, Smell, Hear, Move, Bite / Tired, Sick, Feel |
| transport | Should we take the bus or the train? | direct | bus, train | 9 | 📁 Transport, Bus, Taxi, Bike, Car, Truck, I, Bus stop, The / Train, Take, Plan, Ride, Trip, Travel / Feel, Comfort, Calm |
| transport | Can you see the aeroplane? | direct | yes, no | 2 | 📁 Ready phrases, Oh, I have, Sure, I, Not, Good, What, It's / Need, Fly, Get, Thank, Make, Hear / Feel, Ok, Great |
| transport | Do you need the toilet before we go? | direct | yes, no | 2 | 📁 Ready phrases, Definitely, I'm, Yeah, I, Not, Later, I want, How / Let, Bring, Make, Go, Get, Tell / Feel, Ok, Tired |
| transport | How long until we get there? | direct | i don't know, long | 36 | 📁 Time, Not yet, Tomorrow, Year, I, Not, Dinner, Good, Long / Time, Need, Let, Think, Bite, Guess / Tired, Comfort, Great |
| transport | Did you put your seat belt on? | direct | yes, no, help | 2 | 📁 Ready phrases, Oh, Of course, I'm, I, Not, Not yet, When, Sorry / Get, Ring, Let, Hear, Thank, Sleep / Ok, Fine, I'm tired |
| transport | Do you want music on? | direct | yes, no, music | 2 | 📁 Ready phrases, I have, Yeah, Definitely, I, Music, Tunes, Playlist, Sound / Need, Dance, Let, Make, Thank, Sit / Love, Fine, Tired |
| transport | Are we there yet? | direct | no, yes, soon, not yet, i don't know | 2 | 📁 Ready phrases, I'm, Yeah, Oh, Not yet, I, Soon, Not, Later / Let, Time, Close, Wait, Hear, Grab / Feel, Excited, Hungry |
| selfcare | Ready for bed? | direct | yes, no, not yet, tired | 2 | 📁 Ready phrases, Oh, Yeah, Definitely, I, Good morning, Not yet, Morning, Ready / Need, Sleep, Let, Ride, Talk, Set / Tired, Excited, Feel |
| selfcare | Do you want a story? | direct | yes, no, story, please | 2 | 📁 Ready phrases, Yeah, Let's, I'll, I, Story, You, What, Which / Need, Want, Let, Make, Take, Happen / Love, Sleepy, Ok |
| selfcare | Did you brush your teeth? | direct | yes, no, not yet | 2 | 📁 Ready phrases, Yeah, Of course, I'm, I, Not yet, Not, Good, Morning / Hear, Course, Went, Pretend, Grab, Sleep / Tired, Great, Excited |
| selfcare | Bath or shower tonight? | direct | bath, shower | 11 | 📁 Bathroom & hygiene, Bath, Shower, Shampoo, Dinner, Bedroom, I'm, Sounds good, Brunch / Bathe, Brush, Swim, Surf, Touch, Visit / Shy, Wish, Stressed |
| selfcare | Which pyjamas do you want? | folder | folder Clothing → blue, pyjamas | 81 | 📁 Clothing, Jeans, Clothes, Sweater, I, I need, Not, Good, One / Ring, Need, Want, Make, Sleep, Care / Love, Great, Like |
| selfcare | Do you want the light on or off? | direct | on, off | 20 | 📁 Home & furniture, On, Off, Blanket, Heater, Fan, Thermostat, I, You / Let, Shut, Need, Get, Sleep, Put on / Feel, Lonely, Alarm |
| selfcare | Are you cold? | direct | yes, no, cold, warm | 2 | 📁 Ready phrases, I am, Yeah, Sure, I, Always, Not, Warm, Absolutely / Need, Time, Make, Try, Deal, Course / Cold, Like, Tired |
| selfcare | Do you need to go to the toilet? | direct | yes, no | 2 | 📁 Ready phrases, I'm, Definitely, Yeah, I, Not, I need, Water, I want / Let, Need, Get, Take, Go, Forget / Feel, Tired, Upset |
| selfcare | What do you want to dream about? | direct | i don't know | 97 | 📁 Ideas & topics, Favorite, Life, I, What, About, I want, How, Do you / Hobby, Happen, Want, Need, Watch, Visit / Love, Sleepy, Like |
| selfcare | Good night. Do you want a hug? | direct | yes, no, please | 2 | 📁 Ready phrases, Sure, Oh, Yeah, I, Good, You, Absolutely, Why / Need, Bring, Let, Try, Make, Ask / Love, Great, Ok |
| unknown | What happened? | direct | hurt, i don't know | 95 | 📁 Little words, The, She, And, I, Oh, Good, Dinner, Doctor / Get, Beat, Went, Laugh, Fail, Sit / Hurt, Alarm, Silly |
| unknown | Are you okay? | direct | yes, no, fine | 3 | 📁 Ready phrases, I am, I, Good, Not, Good morning, Sorry, Can I, Why / Need, Mix, Get, Time, Try, Know / Fine, Tired, Ok |
| unknown | What do you need? | direct | help | 55 | 📁 Want & do, I, I need, What, I have, Do you, You, I have a, I am / Need, Fix, Get, Want, Let, Take / Feel, Hurt, Ok |
| unknown | Do you want to go home? | direct | yes, no | 2 | 📁 Ready phrases, I'm, Sure, Oh, Yeah, I, Not, How, Sorry / Let, Go, Get, Come, To go, Plan / Ok, Hurt, I'm hungry |
| unknown | What's wrong? | direct | tired | 39 | 📁 Ideas & topics, Joke, Trouble, Problem, I, It's, Oh, The, I'm / Die, Need, Hear, Time, Get, Lose / Tired, Ok, Mad |
| unknown | Do you want to stop or keep going? | direct | stop, go, more | 28 | 📁 Want & do, I, You, I'm, I like, I want, Definitely, I'll, I am / Keep, Want, Take, Need, Go, Stay / Hurt, I'm hungry, Starving |
| unknown | Who do you want to call? | direct | friend | 115 | 📁 People, You, Friend, Nurse, Mate, I, The, What, Call / Ask, Need, To hear, Ring, Let, Dial / Hope, Nervous, Great |
| unknown | Is it too loud? | direct | yes, no | 2 | 📁 Ready phrases, Yeah, It is, Oh, It's, I, Sound, Not, Noisy / Time, Make, Let, Drive, Leave, Sit / Fine, Like, Feel |
| unknown | What is your favourite animal? | direct | cat, fish, bird | 2 | 📁 Animals, Bird, Fish, Wing, Cat, One, I, Chicken, The / Bear, Fly, Bite, Go, Give, Make / Love, Great, Wish |
| unknown | How old are you? | direct | seven, ten, four | 10 | 📁 Numbers, Thirty, Four, Seven, Ten, I, I'm, I am, Old / Let, Know, Want, See, Leave, Look / Ok, Fine, Happy |

## Misses


Expected labels not in the vocabulary (ignored): blocks, broke, cars, eggs, fell, five minutes, friends, fries, hide and seek, higher, keep going, letters, lost, love you, numbers, pe, plane, reading, seat belt, tag, throw up, too hot, tummy, unicorn, writing
